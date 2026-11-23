// 覆盖初始化网络来源与已有用户状态判断，不把前端是否显示初始化表单当成服务端授权。
// Covers setup network-origin and existing-user checks without treating form visibility as server authorization.
package com.elexvx.humite.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.elexvx.humite.audit.AuditService;
import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import com.elexvx.humite.users.UserRole;
import com.elexvx.humite.users.UserStatus;
import jakarta.validation.Validation;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;

class AuthControllerTest {
    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void ownerSetupOnlyTrustsLocalOrPrivateNetworks() {
        assertTrue(AuthController.isTrustedSetupAddress("127.0.0.1"));
        assertTrue(AuthController.isTrustedSetupAddress("192.168.1.20"));
        assertTrue(AuthController.isTrustedSetupAddress("10.0.0.8"));
        assertTrue(AuthController.isTrustedSetupAddress("172.16.4.2"));
        assertTrue(AuthController.isTrustedSetupAddress("::1"));
        assertTrue(AuthController.isTrustedSetupAddress("fd12:3456::1"));

        assertFalse(AuthController.isTrustedSetupAddress("8.8.8.8"));
        assertFalse(AuthController.isTrustedSetupAddress("1.1.1.1"));
        assertFalse(AuthController.isTrustedSetupAddress("not-an-address"));
    }

    @Test
    void setupStatusReflectsWhetherTheLibraryAlreadyHasUsers() {
        var users = mock(UserRepository.class);
        var controller = new AuthController(users, null, null, null, null, null, null);

        when(users.count()).thenReturn(0L);
        assertFalse(controller.setupStatus().initialized());

        when(users.count()).thenReturn(1L);
        assertTrue(controller.setupStatus().initialized());
    }

    @Test
    void verifiesTheTemporaryPasswordAtLoginAndAcceptsOnlyTheNewPasswordAfterRefresh() {
        var flow = new PasswordFlow();
        assertTrue(flow.login().canChangePasswordWithoutCurrent());
        var reloadedPage = new MockHttpServletRequest();
        reloadedPage.setSession(flow.request.getSession(false));
        assertTrue(flow.controller.session(flow.principal, reloadedPage).canChangePasswordWithoutCurrent());

        when(flow.passwords.encode("new-password")).thenReturn("new-hash");
        when(flow.users.updatePasswordIfCurrent(flow.id, "temporary-hash", "new-hash")).thenReturn(true);
        when(flow.users.findById(flow.id)).thenReturn(Optional.of(flow.account("new-hash", false)));
        var result = flow.controller.changePassword(flow.newPasswordOnly(), flow.principal, reloadedPage);
        assertFalse(result.mustChangePassword());
        assertFalse(result.canChangePasswordWithoutCurrent());
        verify(flow.authentication).authenticate(UsernamePasswordAuthenticationToken.unauthenticated("member", "temporary-password"));
        verify(flow.policy).validate("new-password");
        verify(flow.passwords).encode("new-password");
        verifyNoMoreInteractions(flow.passwords);
    }

    @Test
    void requiresTheCurrentPasswordForSessionsWithoutTemporaryPasswordVerification() {
        var flow = new PasswordFlow();
        assertFalse(flow.controller.session(flow.principal, flow.request).canChangePasswordWithoutCurrent());
        assertEquals("CURRENT_PASSWORD_REQUIRED", assertThrows(ApiException.class,
                () -> flow.controller.changePassword(flow.newPasswordOnly(), flow.principal, flow.request)).code());

        flow.useAccount(flow.account("ordinary-hash", false));
        assertFalse(flow.login().canChangePasswordWithoutCurrent());
        assertEquals("CURRENT_PASSWORD_REQUIRED", assertThrows(ApiException.class,
                () -> flow.controller.changePassword(flow.newPasswordOnly(), flow.principal, flow.request)).code());
        verifyNoInteractions(flow.passwords);
        var wrong = new AuthController.ChangePasswordRequest("wrong-password", "new-password");
        assertEquals("CURRENT_PASSWORD_INVALID", assertThrows(ApiException.class,
                () -> flow.controller.changePassword(wrong, flow.principal, flow.request)).code());
        verify(flow.passwords).matches("wrong-password", "ordinary-hash");
    }

    @Test
    void keepsVerificationAfterValidationFailsAndRejectsAChangedCredential() {
        var flow = new PasswordFlow();
        flow.login();
        var invalid = new AuthController.ChangePasswordRequest(null, "weak");
        doThrow(ApiException.conflict("TEST_POLICY_REJECTED", "Invalid password"))
                .when(flow.policy).validate("weak");
        assertThrows(ApiException.class, () -> flow.controller.changePassword(invalid, flow.principal, flow.request));
        assertTrue(flow.controller.session(flow.principal, flow.request).canChangePasswordWithoutCurrent());
        verifyNoInteractions(flow.passwords);

        when(flow.passwords.encode("new-password")).thenReturn("new-hash");
        assertEquals("PASSWORD_CHANGED", assertThrows(ApiException.class,
                () -> flow.controller.changePassword(flow.newPasswordOnly(), flow.principal, flow.request)).code());
        flow.useAccount(flow.account("replacement-temporary-hash", true));
        assertFalse(flow.controller.session(flow.principal, flow.request).canChangePasswordWithoutCurrent());
        assertEquals("CURRENT_PASSWORD_REQUIRED", assertThrows(ApiException.class,
                () -> flow.controller.changePassword(flow.newPasswordOnly(), flow.principal, flow.request)).code());
    }

    @Test
    void setupRejectsRequestsCarryingProxyForwardingHeadersEvenFromTrustedPeer() {
        var users = mock(UserRepository.class);
        var controller = new AuthController(users, null, null, null, null, null, null);
        var input = new AuthController.SetupRequest("owner", "Owner", "strong-password-123");

        for (String header : List.of("X-Forwarded-For", "Forwarded", "X-Real-IP")) {
            var request = new MockHttpServletRequest();
            request.setRemoteAddr("127.0.0.1");
            request.addHeader(header, "203.0.113.5");
            ApiException error = assertThrows(ApiException.class,
                    () -> controller.setup(input, request, new MockHttpServletResponse()));
            assertEquals("SETUP_NETWORK_FORBIDDEN", error.code());
        }
        verifyNoInteractions(users);
    }

    @Test
    @SuppressWarnings("unchecked")
    void changePasswordRotatesCurrentSessionAndRevokesOtherSessions() {
        var flow = new PasswordFlow();
        FindByIndexNameSessionRepository<Session> sessions = mock(FindByIndexNameSessionRepository.class);
        var controller = new AuthController(flow.users, flow.passwords, flow.authentication,
                new HttpSessionSecurityContextRepository(), new LoginRateLimiter(),
                mock(AuditService.class), flow.policy, sessions, "none");
        flow.useAccount(flow.account("ordinary-hash", false));
        flow.request.setSession(new org.springframework.mock.web.MockHttpSession(null, "current-session"));
        String oldSessionId = flow.request.getSession(false).getId();

        when(flow.passwords.matches("ordinary-password", "ordinary-hash")).thenReturn(true);
        when(flow.passwords.encode("new-password-123")).thenReturn("new-hash");
        when(flow.users.updatePasswordIfCurrent(flow.id, "ordinary-hash", "new-hash")).thenReturn(true);
        when(flow.users.findById(flow.id)).thenReturn(Optional.of(flow.account("new-hash", false)));
        when(sessions.findByPrincipalName("member")).thenReturn(Map.of(
                oldSessionId, mock(Session.class),
                "stolen-other-session", mock(Session.class)));

        controller.changePassword(new AuthController.ChangePasswordRequest("ordinary-password", "new-password-123"),
                flow.principal, flow.request);

        assertNotEquals(oldSessionId, flow.request.getSession(false).getId());
        verify(sessions).deleteById("stolen-other-session");
        verify(sessions, never()).deleteById(oldSessionId);
    }

    @Test
    void loginRequestCapsUsernameAndPasswordLengthsToPreventArgon2Dos() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertTrue(validator.validate(new AuthController.LoginRequest("a".repeat(80), "b".repeat(256))).isEmpty());
            assertFalse(validator.validate(new AuthController.LoginRequest("a".repeat(81), "secret")).isEmpty());
            assertFalse(validator.validate(new AuthController.LoginRequest("alice", "b".repeat(257))).isEmpty());
        }
    }

    private static final class PasswordFlow {
        final UUID id = UUID.randomUUID();
        final UserRepository users = mock(UserRepository.class);
        final PasswordEncoder passwords = mock(PasswordEncoder.class);
        final AuthenticationManager authentication = mock(AuthenticationManager.class);
        final PasswordPolicyService policy = mock(PasswordPolicyService.class);
        final MockHttpServletRequest request = new MockHttpServletRequest();
        final UsernamePasswordAuthenticationToken principal = UsernamePasswordAuthenticationToken.authenticated(
                "member", null, List.of());
        final AuthController controller = new AuthController(users, passwords, authentication,
                new HttpSessionSecurityContextRepository(), new LoginRateLimiter(), mock(AuditService.class), policy);

        PasswordFlow() {
            useAccount(account("temporary-hash", true));
            when(authentication.authenticate(any())).thenReturn(principal);
        }

        void useAccount(HumiteUser user) {
            when(users.findByUsername("member")).thenReturn(Optional.of(user));
        }

        HumiteUser account(String hash, boolean mustChangePassword) {
            return new HumiteUser(id, "member", "Member", hash, UserRole.MEMBER, UserStatus.ACTIVE,
                    mustChangePassword, null, null);
        }

        AuthController.SessionUser login() {
            return controller.login(new AuthController.LoginRequest("member", "temporary-password"), request,
                    new MockHttpServletResponse());
        }

        AuthController.ChangePasswordRequest newPasswordOnly() {
            return new AuthController.ChangePasswordRequest(null, "new-password");
        }
    }
}
