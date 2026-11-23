package com.elexvx.humite.filemanagement;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.elexvx.humite.auth.MustChangePasswordFilter;
import com.elexvx.humite.auth.PermissionTestFixtures;
import com.elexvx.humite.auth.RolePermissionService;
import com.elexvx.humite.auth.SecurityConfig;
import com.elexvx.humite.auth.SessionLifecycleService;
import com.elexvx.humite.auth.SessionLifetimeFilter;
import com.elexvx.humite.common.ApiExceptionHandler;
import com.elexvx.humite.filemanagement.FileOperationModels.FileVersionList;
import com.elexvx.humite.filemanagement.FileOperationModels.Operation;
import com.elexvx.humite.users.UserRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitWebConfig(FileOperationControllerTest.Config.class)
@ActiveProfiles("api")
class FileOperationControllerTest {
    @Configuration
    @EnableWebSecurity
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiExceptionHandler.class, FileOperationController.class})
    static class Config {
        @Bean SessionLifecycleService sessionLifecycle() {
            var service = mock(SessionLifecycleService.class);
            when(service.status(any())).thenReturn(new SessionLifecycleService.Status(
                    Long.MAX_VALUE, false, System.currentTimeMillis()));
            return service;
        }

        @Bean SessionLifetimeFilter sessionLifetimeFilter(SessionLifecycleService service) {
            return new SessionLifetimeFilter(service);
        }

        @Bean UserRepository users() { return PermissionTestFixtures.users(); }

        @Bean RolePermissionService permissions() { return PermissionTestFixtures.permissions(); }

        @Bean MustChangePasswordFilter passwordFilter(UserRepository users) {
            return new MustChangePasswordFilter(users);
        }

        @Bean FileOperationService fileOperationService() { return mock(FileOperationService.class); }

        @Bean FileOperationRepository fileOperationRepository() { return mock(FileOperationRepository.class); }
    }

    @Autowired WebApplicationContext context;
    @Autowired FileOperationService service;
    @Autowired FileOperationRepository operations;
    MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        clearInvocations(service, operations);
    }

    @Test
    void removedListEndpointIsRejectedWhileSingleOperationAndVersionEndpointsRemain() throws Exception {
        UUID id = UUID.randomUUID();
        UUID bookFileId = UUID.randomUUID();
        var op = new Operation(id, FileOperationType.RENAME, FileOperationStatus.SUCCEEDED,
                "root/a.epub", "root/b.epub", OffsetDateTime.now(), "COMPLETE", null, null);
        when(operations.find(id)).thenReturn(Optional.of(op));
        when(service.listVersions(eq(bookFileId), any())).thenReturn(new FileVersionList(List.of()));
        when(service.execute(any(), eq("idem-1"), any())).thenReturn(op);

        mvc.perform(get("/api/v1/file-operations").with(user("admin").roles("ADMIN")))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(get("/api/v1/file-operations").with(user("member").roles("MEMBER")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/file-operations"))
                .andExpect(status().isUnauthorized());

        mvc.perform(get("/api/v1/file-operations/{id}", id).with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id.toString()));
        mvc.perform(get("/api/v1/file-operations/book-files/{bookFileId}/versions", bookFileId)
                        .with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());
        mvc.perform(post("/api/v1/file-operations").with(user("admin").roles("ADMIN")).with(csrf())
                        .header("Idempotency-Key", "idem-1")
                        .contentType("application/json")
                        .content("{\"previewToken\":\"" + UUID.randomUUID() + "\",\"expectedFingerprint\":\"fp\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id.toString()));

        verify(operations).find(id);
        verify(service).listVersions(eq(bookFileId), any());
    }

    @Test
    void missingSingleOperationReturnsNotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(operations.find(id)).thenReturn(Optional.empty());
        mvc.perform(get("/api/v1/file-operations/{id}", id).with(user("owner").roles("OWNER")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("OPERATION_NOT_FOUND"));
        verifyNoInteractions(service);
    }
}
