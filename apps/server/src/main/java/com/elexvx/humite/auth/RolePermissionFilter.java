package com.elexvx.humite.auth;

import com.elexvx.humite.users.UserRepository;
import com.elexvx.humite.users.UserStatus;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/** Re-read the current role on every API request; a historical session never preserves revoked authority. */
public class RolePermissionFilter extends OncePerRequestFilter {
    private final UserRepository users;
    private final RolePermissionService permissions;

    public RolePermissionFilter(UserRepository users, RolePermissionService permissions) {
        this.users = users;
        this.permissions = permissions;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!request.getRequestURI().startsWith("/api/v1/")
                || authentication == null
                || authentication instanceof AnonymousAuthenticationToken
                || !authentication.isAuthenticated()) {
            chain.doFilter(request, response);
            return;
        }
        var user = users.findByUsername(authentication.getName()).orElse(null);
        if (user == null || user.status() != UserStatus.ACTIVE) {
            SecurityContextHolder.clearContext();
            var session = request.getSession(false);
            if (session != null) {
                session.invalidate();
            }
            writeProblemJson(response, 401, "AUTH_REQUIRED", "请重新登录。");
            return;
        }
        var current = UsernamePasswordAuthenticationToken.authenticated(
                authentication.getPrincipal(),
                null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.role().name())));
        current.setDetails(authentication.getDetails());
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(current);
        SecurityContextHolder.setContext(context);
        var required = ApiPermissionPolicy.required(
                request.getMethod(),
                request.getRequestURI(),
                request.getQueryString());
        if (!required.isEmpty() && Collections.disjoint(required, permissions.snapshot(current).grants())) {
            writeProblemJson(response, 403, "PERMISSION_DENIED", "当前角色没有此功能的权限。");
            return;
        }
        chain.doFilter(request, response);
    }

    private void writeProblemJson(
            HttpServletResponse response,
            int status,
            String code,
            String detail) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json;charset=UTF-8");
        response.getWriter().write("{\"code\":\"" + code + "\",\"detail\":\"" + detail + "\"}");
    }
}
