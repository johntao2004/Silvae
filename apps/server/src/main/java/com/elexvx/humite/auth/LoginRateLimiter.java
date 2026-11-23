package com.elexvx.humite.auth;

import com.elexvx.humite.common.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
// 进程内滑动时间窗限流；重启或多实例不会共享这些内存计数。
// Process-local sliding-window rate limiting; counters are not shared across restarts or instances.
public class LoginRateLimiter {
    private static final int LIMIT = 8;
    private static final Duration WINDOW = Duration.ofMinutes(15);
    static final int MAX_TRACKED_KEYS = 10_000;
    private static final int PRUNE_INTERVAL = 256;
    private final Map<String, Deque<Instant>> failures = new LinkedHashMap<>(128, 0.75f, true);
    private final Clock clock;
    private int operations;

    public LoginRateLimiter() {
        this(Clock.systemUTC());
    }

    LoginRateLimiter(Clock clock) {
        this.clock = clock;
    }

    public synchronized void consumeRegistration(String address) {
        String key = "registration:" + address;
        recordOrReject(key, "REGISTRATION_RATE_LIMITED", "注册尝试过于频繁，请稍后再试。");
    }

    public synchronized void consumeRecovery(String value) {
        String key = "recovery:" + value;
        recordOrReject(key, "RECOVERY_RATE_LIMITED", "邮件操作过于频繁，请稍后再试。");
    }

    public synchronized void check(String key) {
        Deque<Instant> attempts = failures.get(key);
        if (attempts == null) return;
        evict(attempts);
        if (attempts.isEmpty()) {
            failures.remove(key);
            return;
        }
        if (attempts.size() >= LIMIT) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "LOGIN_RATE_LIMITED", "登录尝试过于频繁，请稍后再试。");
        }
    }

    public synchronized void failure(String key) {
        pruneIfNeeded(key);
        Deque<Instant> attempts = failures.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        evict(attempts);
        attempts.addLast(clock.instant());
    }

    public synchronized void success(String key) {
        failures.remove(key);
    }

    int trackedKeyCount() {
        return failures.size();
    }

    private void recordOrReject(String key, String code, String message) {
        pruneIfNeeded(key);
        Deque<Instant> attempts = failures.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        evict(attempts);
        if (attempts.size() >= LIMIT) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, code, message);
        }
        attempts.addLast(clock.instant());
    }

    private void pruneIfNeeded(String incomingKey) {
        operations++;
        boolean atCapacity = !failures.containsKey(incomingKey) && failures.size() >= MAX_TRACKED_KEYS;
        if (operations < PRUNE_INTERVAL && !atCapacity) {
            return;
        }
        operations = 0;
        failures.entrySet().removeIf(entry -> {
            evict(entry.getValue());
            return entry.getValue().isEmpty();
        });
        if (!failures.containsKey(incomingKey) && failures.size() >= MAX_TRACKED_KEYS) {
            Iterator<Map.Entry<String, Deque<Instant>>> iterator = failures.entrySet().iterator();
            while (iterator.hasNext() && failures.size() >= MAX_TRACKED_KEYS) {
                iterator.next();
                iterator.remove();
            }
        }
    }

    private void evict(Deque<Instant> attempts) {
        Instant cutoff = clock.instant().minus(WINDOW);
        while (!attempts.isEmpty() && attempts.peekFirst().isBefore(cutoff)) attempts.removeFirst();
    }
}
