package com.elexvx.humite.vault;

import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.filemanagement.infrastructure.PrivateContentStore;
import com.elexvx.humite.users.UserRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

// 服务端按认证用户隔离密文与分块；信封和状态作为客户端生成数据存储。
// The server isolates ciphertext/chunks by authenticated user; envelopes and state are stored as client-generated data.
@Service
public class VaultService {
    private static final Logger log = LoggerFactory.getLogger(VaultService.class);

    private static final int MAX_ENVELOPE_LENGTH = 16_384;
    private static final int MAX_CHUNK_COUNT = 256;
    private static final int MAX_MANIFEST_LENGTH = 32_768;
    private static final int MAX_STATE_LENGTH = 2_000_000;
    private static final int MAX_TOTAL_CHUNKS = 2_048;
    private static final int MAX_VAULT_OBJECTS = 1_000;
    private static final int MIN_CHUNK_BYTES = 16;
    private static final int MAX_CHUNK_BYTES = 1024 * 1024 + 28;
    private static final int CHUNK_READ_LIMIT = MAX_CHUNK_BYTES + 1;
    private static final ObjectMapper JSON = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    private final DSLContext db;
    private final UserRepository users;
    private final PrivateContentStore files;

    public VaultService(DSLContext db, UserRepository users, PrivateContentStore files) {
        this.db = db;
        this.users = users;
        this.files = files;
    }

    public record VaultConfigView(String envelope, long revision) {}

    public record VaultObjectView(
            UUID id,
            String manifest,
            String state,
            long revision,
            @JsonProperty("chunk_count") int chunkCount) {}

    public VaultConfigView getConfig(Principal principal) {
        UUID owner = requireUserId(principal);
        var row = db.fetchOne("select envelope::text, revision from personal_vault where user_id = ?", owner);
        if (row == null) {
            return new VaultConfigView("", 0L);
        }
        String envelope = row.get("envelope", String.class);
        Long revision = row.get("revision", Long.class);
        return new VaultConfigView(envelope == null ? "" : envelope, revision == null ? 0L : revision);
    }

    @Transactional
    public void updateConfig(String envelope, long revision, Principal principal) {
        if (envelope == null || envelope.length() > MAX_ENVELOPE_LENGTH) {
            throw ApiException.badRequest("ENVELOPE_SIZE", "密钥信封格式无效。");
        }
        if (envelope.isBlank()) {
            throw ApiException.badRequest("ENVELOPE_INVALID", "密钥信封格式无效。");
        }
        try {
            JSON.readTree(envelope);
        } catch (JacksonException exception) {
            throw ApiException.badRequest("ENVELOPE_INVALID", "密钥信封格式无效。");
        }
        UUID owner = requireUserId(principal);
        int updated = revision == 0
                ? db.execute(
                        "insert into personal_vault(user_id, envelope) values (?, ?::jsonb) on conflict do nothing",
                        owner,
                        envelope)
                : db.execute(
                        "update personal_vault set envelope = ?::jsonb, revision = revision + 1 "
                                + "where user_id = ? and revision = ? and access_key_ciphertext is null",
                        envelope,
                        owner,
                        revision);
        if (updated != 1) {
            throw ApiException.conflict("REVISION_CONFLICT", "专区设置已更新，请刷新。");
        }
    }

    public List<VaultObjectView> listObjects(Principal principal) {
        UUID owner = requireUserId(principal);
        return db.fetch(
                        "select id, manifest, state, revision, chunk_count "
                                + "from vault_objects where user_id = ? order by created_at desc",
                        owner)
                .map(this::toObjectView);
    }

    public VaultObjectView getObject(UUID id, Principal principal) {
        UUID owner = requireUserId(principal);
        return findOwnedObject(id, owner);
    }

    @Transactional
    public void createObject(UUID id, String manifest, String state, int chunkCount, Principal principal) {
        if (chunkCount < 1
                || chunkCount > MAX_CHUNK_COUNT
                || manifest == null
                || manifest.length() > MAX_MANIFEST_LENGTH
                || state == null
                || state.length() > MAX_STATE_LENGTH) {
            throw ApiException.badRequest("VAULT_INPUT", "密文格式或大小无效。");
        }
        UUID owner = requireUserId(principal);
        db.execute("select pg_advisory_xact_lock(hashtext('vault:' || ?))", owner.toString());
        var quota = db.fetchOne(
                "select coalesce(sum(chunk_count), 0) as total, count(*) as objects "
                        + "from vault_objects where user_id = ?",
                owner);
        if (quota != null
                && (quota.get("total", Long.class) + chunkCount > MAX_TOTAL_CHUNKS
                        || quota.get("objects", Long.class) >= MAX_VAULT_OBJECTS)) {
            throw ApiException.badRequest("VAULT_QUOTA", "个人专区最多保存 2 GiB 密文或 1000 个文件。");
        }
        db.execute(
                "insert into vault_objects(id, user_id, manifest, state, chunk_count) values (?, ?, ?, ?, ?)",
                id,
                owner,
                manifest,
                state,
                chunkCount);
    }

    @Transactional
    public void uploadChunk(UUID id, int index, InputStream input, Principal principal) {
        UUID owner = requireUserId(principal);
        VaultObjectView object = findOwnedObject(id, owner);
        if (index < 0 || index >= object.chunkCount()) {
            throw ApiException.badRequest("CHUNK_INDEX", "分块序号无效。");
        }
        byte[] bytes = readChunkBytes(input);
        if (bytes.length < MIN_CHUNK_BYTES || bytes.length > MAX_CHUNK_BYTES) {
            throw ApiException.badRequest("CHUNK_SIZE", "密文分块过大或无效。");
        }
        String digest = sha256Hex(bytes);
        var previous = db.fetchOne(
                "select digest from vault_chunks where user_id = ? and object_id = ? and chunk_index = ?",
                owner,
                id,
                index);
        if (previous != null) {
            if (!digest.equals(previous.get("digest"))) {
                throw ApiException.conflict("CHUNK_EXISTS", "禁止覆盖已有密文分块。");
            }
            return;
        }
        UUID storageId = UUID.randomUUID();
        try {
            files.create("vault", owner, storageId, new ByteArrayInputStream(bytes), MAX_CHUNK_BYTES);
        } catch (IOException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "VAULT_STORAGE_ERROR", "密文分块保存失败。");
        }
        db.execute("insert into vault_chunks values (?, ?, ?, ?, ?)", owner, id, index, storageId, digest);
    }

    public Resource downloadChunk(UUID id, int index, Principal principal) {
        UUID owner = requireUserId(principal);
        findOwnedObject(id, owner);
        var row = db.fetchOne(
                "select storage_id from vault_chunks where user_id = ? and object_id = ? and chunk_index = ?",
                owner,
                id,
                index);
        if (row == null) {
            throw ApiException.notFound("CHUNK_MISSING", "分块尚未上传，请重新导入。");
        }
        UUID storageId = row.get("storage_id", UUID.class);
        try {
            return files.resource("vault", owner, storageId);
        } catch (IOException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "VAULT_STORAGE_ERROR", "密文分块读取失败。");
        }
    }

    // 阅读状态与普通书籍、文章一致，最后提交生效；密钥信封仍独立执行版本校验。
    // Reading state is last-write-wins; the independent key-envelope revision guard stays intact.
    @Transactional
    public void updateState(UUID id, String state, Principal principal) {
        if (state == null || state.length() > MAX_STATE_LENGTH) {
            throw ApiException.badRequest("STATE_SIZE", "加密记录过大。");
        }
        UUID owner = requireUserId(principal);
        int updated = db.execute(
                "update vault_objects set state = ?, revision = revision + 1 where user_id = ? and id = ?",
                state,
                owner,
                id);
        if (updated != 1) {
            throw ApiException.notFound("VAULT_NOT_FOUND", "未找到密文。");
        }
    }

    @Transactional
    public void deleteObject(UUID id, Principal principal) {
        UUID owner = requireUserId(principal);
        findOwnedObject(id, owner);
        var rows = db.fetch("select storage_id from vault_chunks where user_id = ? and object_id = ?", owner, id);
        db.execute("delete from vault_objects where user_id = ? and id = ?", owner, id);
        // 清理风险说明 / Cleanup caveat: filesystem deletion and database writes are not one transaction; failed cleanup still needs attention.
        for (var row : rows) {
            UUID storageId = row.get("storage_id", UUID.class);
            try {
                files.delete("vault", owner, storageId);
            } catch (IOException | RuntimeException exception) {
                log.warn(
                        "Failed to delete vault chunk file owner={}, objectId={}, storageId={}: {}",
                        owner,
                        id,
                        storageId,
                        exception.getMessage());
            }
        }
    }

    private UUID requireUserId(Principal principal) {
        if (principal == null) {
            throw ApiException.forbidden("AUTH_REQUIRED", "请先登录。");
        }
        return users.findByUsername(principal.getName()).orElseThrow().id();
    }

    private VaultObjectView findOwnedObject(UUID id, UUID owner) {
        var row = db.fetchOne(
                "select id, manifest, state, revision, chunk_count "
                        + "from vault_objects where user_id = ? and id = ?",
                owner,
                id);
        if (row == null) {
            throw ApiException.notFound("VAULT_NOT_FOUND", "未找到密文。");
        }
        return toObjectView(row);
    }

    private VaultObjectView toObjectView(Record row) {
        return new VaultObjectView(
                row.get("id", UUID.class),
                row.get("manifest", String.class),
                row.get("state", String.class),
                row.get("revision", Long.class),
                row.get("chunk_count", Integer.class));
    }

    private byte[] readChunkBytes(InputStream input) {
        try {
            return input.readNBytes(CHUNK_READ_LIMIT);
        } catch (IOException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "VAULT_STORAGE_ERROR", "密文分块读取失败。");
        }
    }

    private String sha256Hex(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 algorithm unavailable", exception);
        }
    }
}
