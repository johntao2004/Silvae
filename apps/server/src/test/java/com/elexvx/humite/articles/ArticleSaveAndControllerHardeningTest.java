package com.elexvx.humite.articles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.elexvx.humite.ai.AiMetadataService;
import com.elexvx.humite.common.ApiExceptionHandler;
import com.elexvx.humite.filemanagement.infrastructure.PrivateContentStore;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.security.Principal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.jooq.DSLContext;
import org.jooq.SQLDialect;
import org.jooq.impl.DSL;
import org.jooq.tools.jdbc.MockConnection;
import org.jooq.tools.jdbc.MockResult;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

class ArticleSaveAndControllerHardeningTest {
    private static final UUID OWNER_ID = UUID.fromString("00000000-0000-4000-8000-000000000011");
    private static final Principal OWNER = () -> "owner";

    @Test
    void saveRunsCleanAndCoverWorkBeforeAdvisoryLockTransactionAndNeverLocksTable() throws Exception {
        List<String> events = new ArrayList<>();
        List<String> executedSql = new ArrayList<>();
        UUID generatedArticleId = UUID.randomUUID();
        DSLContext db = DSL.using(new MockConnection(context -> {
            String sql = context.sql();
            executedSql.add(sql.toLowerCase(java.util.Locale.ROOT));
            String lower = sql.toLowerCase(java.util.Locale.ROOT);
            if (lower.startsWith("select id,source_url")) {
                var d = DSL.using(SQLDialect.POSTGRES);
                return new MockResult[] {new MockResult(0, d.newResult(
                        DSL.field("id", UUID.class), DSL.field("source_url", String.class), DSL.field("html", String.class)))};
            }
            if (lower.startsWith("select exists")) {
                var d = DSL.using(SQLDialect.POSTGRES);
                var field = DSL.field("exists", Boolean.class);
                var result = d.newResult(field);
                var row = d.newRecord(field);
                row.set(field, false);
                result.add(row);
                return new MockResult[] {new MockResult(1, result)};
            }
            if (lower.startsWith("select * from articles")) {
                var d = DSL.using(SQLDialect.POSTGRES);
                var idField = DSL.field("id", UUID.class);
                var coverField = DSL.field("cover_asset_id", UUID.class);
                var result = d.newResult(idField, coverField);
                var row = d.newRecord(idField, coverField);
                row.set(idField, generatedArticleId);
                row.set(coverField, null);
                result.add(row);
                return new MockResult[] {new MockResult(1, result)};
            }
            return new MockResult[0];
        }), SQLDialect.POSTGRES);

        var owner = mock(HumiteUser.class);
        when(owner.id()).thenReturn(OWNER_ID);
        when(owner.canManageFiles()).thenReturn(true);
        var users = mock(UserRepository.class);
        when(users.findByUsername("owner")).thenReturn(Optional.of(owner));
        var files = mock(PrivateContentStore.class);
        var txManager = new AbstractPlatformTransactionManager() {
            @Override protected Object doGetTransaction() { return new Object(); }
            @Override protected void doBegin(Object transaction, TransactionDefinition definition) { events.add("TX_BEGIN"); }
            @Override protected void doCommit(DefaultTransactionStatus status) { events.add("TX_COMMIT"); }
            @Override protected void doRollback(DefaultTransactionStatus status) { events.add("TX_ROLLBACK"); }
        };
        var service = new ArticleService(db, users, null, files, (AiMetadataService) null, null) {
            @Override public String clean(String html, String base, Principal principal) {
                events.add("CLEAN");
                return super.clean(html, base, principal);
            }

            @Override public UUID asset(byte[] bytes, Principal principal) throws java.io.IOException {
                events.add("ASSET");
                return super.asset(bytes, principal);
            }
        };
        service.setTransactionManager(txManager);

        var image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        var out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        String coverData = "data:image/png;base64," + java.util.Base64.getEncoder().encodeToString(out.toByteArray());
        var draft = new ArticleService.Draft("标题", "作者", "https://example.test/post", "", "PUBLIC", "", "<p>正文</p>", coverData);

        service.save(null, draft, OWNER);

        assertThat(events).containsExactly("CLEAN", "ASSET", "TX_BEGIN", "TX_COMMIT");
        assertThat(executedSql).noneMatch(sql -> sql.contains("lock table articles"));
        assertThat(executedSql).anyMatch(sql -> sql.contains("pg_advisory_xact_lock(hashtext('humite:articles:save'))"));
    }

    @Test
    void readingEndpointRejectsNullStateViaValidAnnotationAndFetchStreamEmitsGenericErrorOnFailure() throws Exception {
        var service = mock(ArticleService.class);
        when(service.prepareFetch("https://example.test/a", null)).thenReturn("https://example.test/a");
        when(service.executeFetch(eq("https://example.test/a"), any(), any()))
                .thenThrow(new IllegalStateException("internal sensitive error"));
        when(service.serializeStreamEvent(any())).thenCallRealMethod();

        var mvc = MockMvcBuilders.standaloneSetup(new ArticleController(service))
                .setControllerAdvice(new ApiExceptionHandler())
                .build();

        mvc.perform(put("/api/v1/articles/{id}/reading", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revision\":1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        var streamResult = mvc.perform(post("/api/v1/articles/fetch-stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"url\":\"https://example.test/a\"}"))
                .andExpect(status().isOk())
                .andReturn();
        String body = streamResult.getResponse().getContentAsString();
        assertThat(body).contains("\"code\":\"FETCH_FAILED\"").doesNotContain("internal sensitive error");
    }
}
