package com.elexvx.humite.auth;

import com.elexvx.humite.audit.AuditService;
import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import com.elexvx.humite.users.UserRole;
import com.elexvx.humite.users.UserStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Objects;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("api")
@RequestMapping("/api/v1/auth")
public class AuthController {
    private static final String TEMPORARY_CREDENTIAL = AuthController.class.getName() + ".temporaryCredential";

    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final AuthenticationManager authenticationManager;
    private final HttpSessionSecurityContextRepository contextRepository;
    private final LoginRateLimiter rateLimiter;
    private final AuditService audit;
    private final com.elexvx.humite.auth.PasswordPolicyService passwordPolicy;
    private final FindByIndexNameSessionRepository<? extends Session> sessionRepository;
    private final String forwardHeadersStrategy;

    public AuthController(UserRepository users, PasswordEncoder passwords, AuthenticationManager authenticationManager,
                          HttpSessionSecurityContextRepository contextRepository, LoginRateLimiter rateLimiter,
                          AuditService audit, com.elexvx.humite.auth.PasswordPolicyService passwordPolicy) {
        this(users, passwords, authenticationManager, contextRepository, rateLimiter, audit, passwordPolicy,
                (FindByIndexNameSessionRepository<? extends Session>) null, "none");
    }

    @Autowired
    public AuthController(UserRepository users, PasswordEncoder passwords, AuthenticationManager authenticationManager,
                          HttpSessionSecurityContextRepository contextRepository, LoginRateLimiter rateLimiter,
                          AuditService audit, com.elexvx.humite.auth.PasswordPolicyService passwordPolicy,
                          ObjectProvider<FindByIndexNameSessionRepository<? extends Session>> sessionRepository,
                          @Value("${server.forward-headers-strategy:none}") String forwardHeadersStrategy) {
        this(users, passwords, authenticationManager, contextRepository, rateLimiter, audit, passwordPolicy,
                sessionRepository == null ? null : sessionRepository.getIfAvailable(), forwardHeadersStrategy);
    }

    AuthController(UserRepository users, PasswordEncoder passwords, AuthenticationManager authenticationManager,
                   HttpSessionSecurityContextRepository contextRepository, LoginRateLimiter rateLimiter,
                   AuditService audit, com.elexvx.humite.auth.PasswordPolicyService passwordPolicy,
                   FindByIndexNameSessionRepository<? extends Session> sessionRepository,
                   String forwardHeadersStrategy) {
        this.users = users;
        this.passwords = passwords;
        this.authenticationManager = authenticationManager;
        this.contextRepository = contextRepository;
        this.rateLimiter = rateLimiter;
        this.audit = audit;
        this.passwordPolicy = passwordPolicy;
        this.sessionRepository = sessionRepository;
        this.forwardHeadersStrategy = forwardHeadersStrategy == null ? "none" : forwardHeadersStrategy;
    }

    @GetMapping("/csrf")
    CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getToken(), token.getHeaderName());
    }

    @GetMapping("/setup-status")
    SetupStatus setupStatus() {
        return new SetupStatus(users.count() > 0);
    }

    // 初始化同时受来源地址和数据库首次创建锁约束，不能只依赖 setup-status 页面检查。
    // Setup relies on both the remote address and database first-owner lock, not only the setup-status UI check.
    @PostMapping("/setup")
    SessionUser setup(@Valid @RequestBody SetupRequest input, HttpServletRequest request, HttpServletResponse response) {
        if (!isTrustedSetupAddress(request.getRemoteAddr())
                || ("none".equalsIgnoreCase(forwardHeadersStrategy) && hasUnexpectedForwardingHeaders(request))) {
            throw ApiException.forbidden("SETUP_NETWORK_FORBIDDEN", "站点所有者初始化只允许从 NAS 本机或局域网直接访问。");
        }
        passwordPolicy.validate(input.password());
        var created = users.createOwnerIfEmpty(input.username(), input.displayName(), passwords.encode(input.password()))
                .orElseThrow(() -> ApiException.conflict("ALREADY_INITIALIZED", "Humite已经完成初始化。"));
        var authentication = authenticationManager.authenticate(UsernamePasswordAuthenticationToken.unauthenticated(created.username(), input.password()));
        saveAuthentication(authentication, request, response);
        audit.record(created.id(), "OWNER_INITIALIZED", "USER", created.id().toString(), null, null, null, null,
                "SUCCEEDED", "{}");
        return SessionUser.from(created);
    }

    @PostMapping("/login")
    SessionUser login(@Valid @RequestBody LoginRequest input, HttpServletRequest request, HttpServletResponse response) {
        String key = request.getRemoteAddr() + ":" + input.username().toLowerCase(Locale.ROOT);
        rateLimiter.check(key);
        try {
            var beforeLogin = users.findByUsername(input.username()).orElse(null);
            var authentication = authenticationManager.authenticate(UsernamePasswordAuthenticationToken.unauthenticated(input.username(), input.password()));
            var user = users.findByUsername(authentication.getName()).orElse(null);
            // 只有认证前后的凭据一致，才能为新会话记录已验证的临时密码。
            if (beforeLogin == null || user == null || user.status() != UserStatus.ACTIVE
                    || !beforeLogin.id().equals(user.id()) || !beforeLogin.passwordHash().equals(user.passwordHash())) {
                throw ApiException.conflict("LOGIN_CREDENTIAL_CHANGED", "登录凭据已变更，请重新登录。");
            }
            saveAuthentication(authentication, request, response);
            if (user.mustChangePassword()) {
                request.getSession(false).setAttribute(TEMPORARY_CREDENTIAL, temporaryCredential(user));
            }
            users.recordLogin(user.id());
            rateLimiter.success(key);
            audit.recordLogin(user.id(), input.username(), "SUCCEEDED", request.getRemoteAddr());
            return SessionUser.from(user, canChangePasswordWithoutCurrent(user, request));
        } catch (AuthenticationException exception) {
            rateLimiter.failure(key);
            audit.recordLogin(users.findByUsername(input.username()).map(HumiteUser::id).orElse(null),
                    input.username().toLowerCase(Locale.ROOT), "FAILED", request.getRemoteAddr());
            throw new ApiException(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS", "用户名或密码不正确。");
        }
    }

    @GetMapping("/session")
    SessionUser session(Principal principal, HttpServletRequest request) {
        var user = current(principal);
        return SessionUser.from(user, canChangePasswordWithoutCurrent(user, request));
    }

    @PutMapping("/password")
    SessionUser changePassword(@Valid @RequestBody ChangePasswordRequest input, Principal principal, HttpServletRequest request) {
        var user = current(principal);
        if (input.currentPassword() == null) {
            if (!canChangePasswordWithoutCurrent(user, request)) {
                String message = user.mustChangePassword() ? "请输入当前临时密码，或重新登录后再试。" : "请输入当前密码。";
                throw ApiException.badRequest("CURRENT_PASSWORD_REQUIRED", message);
            }
        } else if (input.currentPassword().isBlank() || !passwords.matches(input.currentPassword(), user.passwordHash())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CURRENT_PASSWORD_INVALID", "当前密码不正确。");
        }
        passwordPolicy.validate(input.newPassword());
        if (!users.updatePasswordIfCurrent(user.id(), user.passwordHash(), passwords.encode(input.newPassword()))) {
            throw ApiException.conflict("PASSWORD_CHANGED", "密码或账户状态已变更，请重新登录后再试。");
        }
        var session = request.getSession(false);
        String previousSessionId = null;
        String currentSessionId = null;
        if (session != null) {
            session.removeAttribute(TEMPORARY_CREDENTIAL);
            previousSessionId = session.getId();
            currentSessionId = request.changeSessionId();
        }
        revokeOtherSessions(user.username(), previousSessionId, currentSessionId);
        audit.record(user.id(), "PASSWORD_CHANGED", "USER", user.id().toString(), null, null, null, null,
                "SUCCEEDED", "{}");
        return SessionUser.from(users.findById(user.id()).orElseThrow());
    }

    private void revokeOtherSessions(String username, String previousSessionId, String currentSessionId) {
        if (sessionRepository == null) return;
        var active = sessionRepository.findByPrincipalName(username);
        if (active == null || active.isEmpty()) return;
        for (String id : active.keySet()) {
            if (!Objects.equals(id, previousSessionId) && !Objects.equals(id, currentSessionId)) {
                sessionRepository.deleteById(id);
            }
        }
    }

    private boolean canChangePasswordWithoutCurrent(HumiteUser user, HttpServletRequest request) {
        if (!user.mustChangePassword() || user.status() != UserStatus.ACTIVE) return false;
        var session = request.getSession(false);
        return session != null && Objects.equals(session.getAttribute(TEMPORARY_CREDENTIAL), temporaryCredential(user));
    }

    private static String temporaryCredential(HumiteUser user) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return user.id() + ":" + HexFormat.of().formatHex(digest.digest(user.passwordHash().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @PostMapping("/logout")
    void logout(HttpServletRequest request, HttpServletResponse response) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        var user = authentication == null ? null : users.findByUsername(authentication.getName()).orElse(null);
        new SecurityContextLogoutHandler().logout(request, response, authentication);
        if (user != null) audit.record(user.id(), "LOGOUT", "USER", user.id().toString(), null, null, null, null,
                "SUCCEEDED", "{}");
    }

    private HumiteUser current(Principal principal) {
        if (principal == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "请先登录。");
        return users.findByUsername(principal.getName()).orElseThrow();
    }

    // 手动认证必须轮换会话并显式保存上下文，与 requireExplicitSave 配置配套。
    // Manual authentication rotates the session and explicitly saves its context to match requireExplicitSave.
    private void saveAuthentication(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        var previous = request.getSession(false);
        if (previous != null) previous.invalidate();
        request.getSession(true);
        request.changeSessionId();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
    }

    // 这里只解析字面 IP，不信任用户提供的主机名或转发头。
    // Only literal IP addresses are parsed here, not caller-provided hostnames or forwarding headers.
    static boolean isTrustedSetupAddress(String remoteAddress) {
        if (remoteAddress == null) return false;
        String literal = remoteAddress.contains("%") ? remoteAddress.substring(0, remoteAddress.indexOf('%')) : remoteAddress;
        if (!literal.matches("[0-9a-fA-F:.]+")) return false;
        try {
            InetAddress address = InetAddress.getByName(literal);
            if (address.isAnyLocalAddress() || address.isLoopbackAddress()
                    || address.isLinkLocalAddress() || address.isSiteLocalAddress()) return true;
            byte[] bytes = address.getAddress();
            return bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc;
        } catch (UnknownHostException exception) {
            return false;
        }
    }

    private static boolean hasUnexpectedForwardingHeaders(HttpServletRequest request) {
        return hasNonBlankHeader(request, "X-Forwarded-For")
                || hasNonBlankHeader(request, "Forwarded")
                || hasNonBlankHeader(request, "X-Real-IP");
    }

    private static boolean hasNonBlankHeader(HttpServletRequest request, String name) {
        var headers = request.getHeaders(name);
        if (headers == null) return false;
        while (headers.hasMoreElements()) {
            String value = headers.nextElement();
            if (value != null && !value.isBlank()) return true;
        }
        return false;
    }

    public record CsrfResponse(String token, String headerName) {}
    public record SetupStatus(boolean initialized) {}
    public record LoginRequest(
            @NotBlank @Size(max = 80) String username,
            @NotBlank @Size(max = 256) String password) {}
    public record SetupRequest(
            @NotBlank @Pattern(regexp = "[a-zA-Z0-9._-]{3,80}") String username,
            @NotBlank @Size(max = 120) String displayName,
            @NotBlank @Size(max = PasswordPolicyService.MAX_PASSWORD_LENGTH) String password) {}
    public record ChangePasswordRequest(String currentPassword,
            @NotBlank @Size(max = PasswordPolicyService.MAX_PASSWORD_LENGTH) String newPassword) {}
    public record SessionUser(String id, String username, String displayName, UserRole role, boolean mustChangePassword,
                              boolean canChangePasswordWithoutCurrent) {
        static SessionUser from(HumiteUser user) {
            return from(user, false);
        }

        static SessionUser from(HumiteUser user, boolean canChangePasswordWithoutCurrent) {
            return new SessionUser(user.id().toString(), user.username(), user.displayName(), user.role(),
                    user.mustChangePassword(), canChangePasswordWithoutCurrent);
        }
    }
}
