// 验证连续失败阈值和键隔离，避免一个登录来源的计数污染其他来源。
// Checks failure thresholds and key isolation so one login source does not contaminate another’s counter.
package com.elexvx.humite.auth;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.elexvx.humite.common.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class LoginRateLimiterTest {
    @Test
    void blocksAfterEightFailuresAndIsolatedByKey() {
        LoginRateLimiter limiter = new LoginRateLimiter();
        for (int attempt = 0; attempt < 8; attempt++) {
            assertDoesNotThrow(() -> limiter.check("one"));
            limiter.failure("one");
        }
        assertThrows(ApiException.class, () -> limiter.check("one"));
        assertDoesNotThrow(() -> limiter.check("two"));
        limiter.success("one");
        assertDoesNotThrow(() -> limiter.check("one"));
    }

    @Test
    void prunesExpiredEntriesAndBoundsTrackedCapacity() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-22T00:00:00Z"));
        Clock clock = new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return now.get(); }
        };
        LoginRateLimiter limiter = new LoginRateLimiter(clock);
        for (int i = 0; i < 200; i++) {
            limiter.failure("stale-" + i);
        }
        now.set(now.get().plus(Duration.ofMinutes(16)));
        for (int i = 0; i < 60; i++) {
            limiter.failure("fresh-" + i);
        }
        assertTrue(limiter.trackedKeyCount() <= 60);

        for (int i = 0; i < LoginRateLimiter.MAX_TRACKED_KEYS + 500; i++) {
            limiter.failure("flood-" + i);
        }
        assertEquals(LoginRateLimiter.MAX_TRACKED_KEYS, limiter.trackedKeyCount());
    }
}
