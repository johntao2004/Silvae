package com.elexvx.humite.vault;

import com.elexvx.humite.vault.VaultService.VaultConfigView;
import com.elexvx.humite.vault.VaultService.VaultObjectView;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 传递密文信封、分块和 revision；身份隔离及存储规则交给 VaultService。
// Transfers ciphertext envelopes, chunks and revisions while VaultService enforces identity isolation and storage rules.
@RestController
@Profile("api")
@RequestMapping("/api/v1/vault")
public class VaultController {
    private final VaultService service;
    private final VaultKeyService keys;

    public VaultController(VaultService service, VaultKeyService keys) {
        this.service = service;
        this.keys = keys;
    }

    @PostMapping("/key/open")
    public VaultKeyService.Access openKey(Principal principal) {
        return keys.open(principal);
    }

    @PostMapping("/key/migrate")
    public VaultKeyService.Access migrateKey(@RequestBody KeyMigration in, Principal principal) {
        return keys.migrate(in.key(), in.revision(), principal);
    }

    @GetMapping("/config")
    public VaultConfigView getConfig(Principal principal) {
        return service.getConfig(principal);
    }

    @PutMapping("/config")
    public ResponseEntity<Void> updateConfig(@RequestBody Config in, Principal principal) {
        service.updateConfig(in.envelope(), in.revision(), principal);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/objects")
    public List<VaultObjectView> listObjects(Principal principal) {
        return service.listObjects(principal);
    }

    @PostMapping("/objects/{id}")
    public ResponseEntity<Void> createObject(
            @PathVariable UUID id,
            @RequestBody Create in,
            Principal principal) {
        service.createObject(id, in.manifest(), in.state(), in.chunkCount(), principal);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/objects/{id}/chunks/{index}")
    public ResponseEntity<Void> uploadChunk(
            @PathVariable UUID id,
            @PathVariable int index,
            HttpServletRequest request,
            Principal principal) throws IOException {
        service.uploadChunk(id, index, request.getInputStream(), principal);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/objects/{id}/chunks/{index}")
    public ResponseEntity<Resource> downloadChunk(
            @PathVariable UUID id,
            @PathVariable int index,
            Principal principal) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(service.downloadChunk(id, index, principal));
    }

    @PutMapping("/objects/{id}/state")
    public ResponseEntity<Void> updateState(
            @PathVariable UUID id,
            @RequestBody State in,
            Principal principal) {
        service.updateState(id, in.state(), principal);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/objects/{id}")
    public ResponseEntity<Void> deleteObject(@PathVariable UUID id, Principal principal) {
        service.deleteObject(id, principal);
        return ResponseEntity.noContent().build();
    }

    public record Config(String envelope, long revision) {}

    public record KeyMigration(String key, long revision) {
        @Override
        public String toString() {
            return "VaultKeyMigration[redacted]";
        }
    }

    public record Create(String manifest, String state, int chunkCount) {}

    public record State(String state, long revision) {}
}
