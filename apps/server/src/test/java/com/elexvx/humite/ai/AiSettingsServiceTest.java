package com.elexvx.humite.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;

import com.elexvx.humite.audit.AuditService;
import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.config.HumiteProperties;
import com.elexvx.humite.config.HumiteProperties.AiProvider;
import com.elexvx.humite.config.HumiteProperties.AiProviderType;
import com.elexvx.humite.users.UserRepository;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRole;
import com.elexvx.humite.users.UserStatus;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.Test;

class AiSettingsServiceTest {
    @Test
    void persistedZhipuProviderOverridesNewApplicationDefaultsWithoutBeingReplaced() {
        var defaults = new AiProvider("zhipu", "智谱", AiProviderType.OPENAI_COMPATIBLE, false,
                "https://open.bigmodel.cn/api/paas/v4/", "", "glm-4.7-flash");
        var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null,
                new HumiteProperties.Ai(false, true, 4, Duration.ofSeconds(20), List.of(defaults), "test-ai-settings-key"));
        var crypto = new AiSettingsCrypto(properties);
        var repository = mock(AiSettingsRepository.class);
        when(repository.global()).thenReturn(Optional.empty());
        when(repository.providers()).thenReturn(List.of(new AiSettingsRepository.ProviderSettings(
                "zhipu", "已保存的智谱名称", AiProviderType.OPENAI_COMPATIBLE, true,
                "https://custom.example/v1", crypto.encrypt("stored-provider-secret"), "custom-model")));

        var service = new AiSettingsService(properties, repository, crypto, mock(UserRepository.class), mock(AuditService.class));
        var effective = service.effective().providers().getFirst();
        var view = service.view().providers().getFirst();

        assertEquals("zhipu", effective.id());
        assertEquals("已保存的智谱名称", effective.label());
        assertEquals("https://custom.example/v1", effective.baseUrl());
        assertEquals("custom-model", effective.model());
        assertEquals("stored-provider-secret", effective.apiKey());
        assertEquals("custom-model", view.model());
        assertEquals(true, view.enabled());
        assertEquals(true, view.apiKeyConfigured());
        verify(repository, never()).save(any(), anyList(), any());
    }

    @Test
    void savingBlankKeyRetainsAndPersistsOnlyEncryptedProviderSecret() {
        var defaults = new AiProvider("zhipu", "智谱", AiProviderType.OPENAI_COMPATIBLE, false,
                "https://open.bigmodel.cn/api/paas/v4/", "", "glm-4.7-flash");
        var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null,
                new HumiteProperties.Ai(false, true, 4, Duration.ofSeconds(20), List.of(defaults), "test-ai-settings-key"));
        var crypto = new AiSettingsCrypto(properties);
        var repository = mock(AiSettingsRepository.class);
        var storedCiphertext = crypto.encrypt("stored-provider-secret");
        when(repository.global()).thenReturn(Optional.empty());
        when(repository.providers()).thenReturn(List.of(new AiSettingsRepository.ProviderSettings(
                "zhipu", "智谱", AiProviderType.OPENAI_COMPATIBLE, false, defaults.baseUrl(), storedCiphertext, defaults.model())));
        var users = mock(UserRepository.class);
        var actorId = UUID.randomUUID();
        when(users.findByUsername("owner")).thenReturn(Optional.of(new HumiteUser(actorId, "owner", "Owner", "hash",
                UserRole.OWNER, UserStatus.ACTIVE, false, OffsetDateTime.now(), null)));
        var service = new AiSettingsService(properties, repository, crypto, users, mock(AuditService.class));

        service.update(new AiSettingsService.AiSettingsInput(false, true, 4, 20, List.of(
                new AiSettingsService.AiProviderInput("zhipu", "智谱", "OPENAI_COMPATIBLE", true,
                        defaults.baseUrl(), "glm-4.7-flash", "", false))), "owner");

        var saved = ArgumentCaptor.forClass(List.class);
        verify(repository).save(any(), saved.capture(), eq(actorId));
        var provider = (AiSettingsRepository.ProviderSettings) saved.getValue().getFirst();
        assertEquals("v1:", provider.apiKeyCiphertext().substring(0, 3));
        assertEquals("stored-provider-secret", crypto.decrypt(provider.apiKeyCiphertext()));
        assertFalse(provider.apiKeyCiphertext().contains("stored-provider-secret"));
    }

    @Test
    void changingProviderOriginWithBlankKeyClearsStoredSecretToPreventExfiltration() {
        var defaults = new AiProvider("openai", "OpenAI", AiProviderType.OPENAI_COMPATIBLE, false,
                "https://api.openai.com/v1", "", "gpt-4o-mini");
        var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null,
                new HumiteProperties.Ai(false, true, 4, Duration.ofSeconds(20), List.of(defaults), "test-ai-settings-key"));
        var crypto = new AiSettingsCrypto(properties);
        var repository = mock(AiSettingsRepository.class);
        when(repository.global()).thenReturn(Optional.empty());
        when(repository.providers()).thenReturn(List.of(new AiSettingsRepository.ProviderSettings(
                "openai", "OpenAI", AiProviderType.OPENAI_COMPATIBLE, true,
                "https://api.openai.com/v1", crypto.encrypt("owner-secret"), "gpt-4o-mini")));
        var users = mock(UserRepository.class);
        var actorId = UUID.randomUUID();
        when(users.findByUsername("admin")).thenReturn(Optional.of(new HumiteUser(actorId, "admin", "Admin", "hash",
                UserRole.ADMIN, UserStatus.ACTIVE, false, OffsetDateTime.now(), null)));
        var service = new AiSettingsService(properties, repository, crypto, users, mock(AuditService.class));

        service.update(new AiSettingsService.AiSettingsInput(true, true, 4, 20, List.of(
                new AiSettingsService.AiProviderInput("openai", "OpenAI", "OPENAI_COMPATIBLE", true,
                        "https://attacker.example/v1", "gpt-4o-mini", "", false))), "admin");

        var saved = ArgumentCaptor.forClass(List.class);
        verify(repository).save(any(), saved.capture(), eq(actorId));
        var provider = (AiSettingsRepository.ProviderSettings) saved.getValue().getFirst();
        assertNull(provider.apiKeyCiphertext());
    }

    @Test
    void rejectsInvalidBaseUrlAndDoesNotTreatLookalikeLocalhostAsConfigured() {
        var lookalike = new AiProvider("custom", "Custom", AiProviderType.OPENAI_COMPATIBLE, true,
                "https://localhost.attacker.example/v1", "", "model");
        var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null,
                new HumiteProperties.Ai(true, true, 4, Duration.ofSeconds(20), List.of(lookalike), "test-ai-settings-key"));
        var crypto = new AiSettingsCrypto(properties);
        var repository = mock(AiSettingsRepository.class);
        when(repository.global()).thenReturn(Optional.empty());
        when(repository.providers()).thenReturn(List.of());
        var users = mock(UserRepository.class);
        var actorId = UUID.randomUUID();
        when(users.findByUsername("owner")).thenReturn(Optional.of(new HumiteUser(actorId, "owner", "Owner", "hash",
                UserRole.OWNER, UserStatus.ACTIVE, false, OffsetDateTime.now(), null)));
        var service = new AiSettingsService(properties, repository, crypto, users, mock(AuditService.class));

        assertFalse(service.view().providers().getFirst().configured());
        assertTrue(AiMetadataService.isLocalBaseUrl("http://127.0.0.1:11434/v1"));

        ApiException invalid = assertThrows(ApiException.class, () -> service.update(
                new AiSettingsService.AiSettingsInput(true, true, 4, 20, List.of(
                        new AiSettingsService.AiProviderInput("custom", "Custom", "OPENAI_COMPATIBLE", true,
                                "ftp://example.com/v1", "model", "", false))), "owner"));
        assertEquals("AI_BASE_URL_INVALID", invalid.code());
    }
}
