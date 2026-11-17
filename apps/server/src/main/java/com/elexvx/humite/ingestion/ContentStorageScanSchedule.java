package com.elexvx.humite.ingestion;

import com.elexvx.humite.filemanagement.ContentStorageService;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class ContentStorageScanSchedule {
    private final ContentStorageService scans;
    public ContentStorageScanSchedule(ContentStorageService scans) { this.scans = scans; }
    @Scheduled(fixedDelayString = "${humite.scan.interval:5m}", initialDelayString = "1m")
    public void scan() { scans.scanAll(); }
}
