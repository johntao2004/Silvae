package com.elexvx.humite.ingestion;
import com.elexvx.humite.config.HumiteProperties;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ApplicationArguments;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
@Component
@Profile("worker")
// 启动时登记配置根目录并检查能力，后续定时刷新可访问状态。
// Registers configured roots and probes capabilities at startup, then refreshes availability on schedule.
public class LibraryRootSchedule implements ApplicationRunner {
    private final LibraryRootRepository roots;
    private final HumiteProperties properties;
    private final LibraryRootCapabilityService capabilities;
    public LibraryRootSchedule(LibraryRootRepository roots, HumiteProperties properties, LibraryRootCapabilityService capabilities) {
        this.roots = roots; this.properties = properties; this.capabilities = capabilities;
    }
    public void run(ApplicationArguments args) {
        for (var root : properties.storage().roots()) roots.upsertConfigured(root.name(), root.path());
        capabilities.checkAll();
    }
    @Scheduled(fixedDelayString = "1m", initialDelayString = "30s")
    public void checkAll() { capabilities.checkAll(); }
}
