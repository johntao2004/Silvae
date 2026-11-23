package com.elexvx.humite.reading;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import com.elexvx.humite.auth.*;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitWebConfig(ReadingOverviewAuthenticationTest.Config.class)
@ActiveProfiles("api")
class ReadingOverviewAuthenticationTest {
    @Configuration
    @EnableWebSecurity
    @EnableWebMvc
    @Import({SecurityConfig.class, ReadingOverviewController.class})
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

        @Bean UserRepository users() { return com.elexvx.humite.auth.PermissionTestFixtures.users(); }

        @Bean com.elexvx.humite.auth.RolePermissionService permissions() { return com.elexvx.humite.auth.PermissionTestFixtures.permissions(); }

        @Bean MustChangePasswordFilter passwordFilter(UserRepository users) {
            return new MustChangePasswordFilter(users);
        }

        @Bean ReadingOverviewService overview() { return mock(ReadingOverviewService.class); }
    }

    @Autowired WebApplicationContext context;
    @Autowired ReadingOverviewService overview;
    @Autowired UserRepository users;

    @Test void anonymousRequestsCannotReadAnyOverviewDataAndLegacyStatsRouteIsGone() throws Exception {
        reset(overview);
        var mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        mvc.perform(get("/api/v1/reading-overview")).andExpect(status().isUnauthorized());
        mvc.perform(head("/api/v1/reading-overview")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/reading-stats/weekly")).andExpect(status().isUnauthorized());
        var owner = mock(HumiteUser.class);
        when(owner.id()).thenReturn(UUID.randomUUID());
        when(owner.role()).thenReturn(com.elexvx.humite.users.UserRole.OWNER);
        when(owner.status()).thenReturn(com.elexvx.humite.users.UserStatus.ACTIVE);
        when(users.findByUsername("owner")).thenReturn(Optional.of(owner));
        mvc.perform(get("/api/v1/reading-stats/weekly").with(user("owner").roles("OWNER"))).andExpect(status().isNotFound());
        verifyNoInteractions(overview);
    }

    @Test void everyRoleSeesOnlyItsOwnReadingAndWeeklyStatsEvenWhenAnotherUserIdIsSupplied() throws Exception {
        reset(overview);
        var mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        var today = LocalDate.parse("2026-11-22");
        var stats = new ReadingRepository.WeeklyReadingStats(
                LocalDate.parse("2026-11-16"), today, 420, 180,
                List.of(new ReadingRepository.DailyReadingTime(today, 420)));
        for (var role : List.of("MEMBER", "ADMIN", "OWNER")) {
            var id = UUID.randomUUID();
            var actor = mock(HumiteUser.class);
            when(actor.id()).thenReturn(id);
            when(actor.role()).thenReturn(com.elexvx.humite.users.UserRole.valueOf(role));
            when(actor.status()).thenReturn(com.elexvx.humite.users.UserStatus.ACTIVE);
            when(users.findByUsername(role)).thenReturn(Optional.of(actor));
            when(overview.current(id)).thenReturn(new ReadingOverviewService.Overview(today, null, List.of(), stats));
            mvc.perform(get("/api/v1/reading-overview").param("userId", UUID.randomUUID().toString()).with(user(role).roles(role)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.recentReading").isEmpty())
                    .andExpect(jsonPath("$.stats.totalSeconds").value(420))
                    .andExpect(jsonPath("$.stats.previousWeekSeconds").value(180))
                    .andExpect(jsonPath("$.stats.days[0].seconds").value(420));
            verify(overview).current(id);
        }
        verifyNoMoreInteractions(overview);
    }
}
