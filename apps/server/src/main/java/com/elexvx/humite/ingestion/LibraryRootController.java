package com.elexvx.humite.ingestion;

import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.filemanagement.ContentStorageService;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("api")
@RequestMapping("/api/v1/library-roots")
@PreAuthorize("hasAnyRole('OWNER','ADMIN')")
// 展示配置书库及能力检查；保留旧登记端点以返回明确的功能关闭提示。
public class LibraryRootController {
    private final LibraryRootRepository roots;
    private final LibraryRootRegistrationService registration;
    private final LibraryRootCapabilityService capabilities;
    private final ContentStorageService content;

    public LibraryRootController(LibraryRootRepository roots, LibraryRootRegistrationService registration,
                                 LibraryRootCapabilityService capabilities, ContentStorageService content) {
        this.roots = roots;
        this.registration = registration;
        this.capabilities = capabilities;
        this.content = content;
    }

    @GetMapping("/content-storage")
    public List<ContentStorageService.Snapshot> contentStorage() { return content.snapshots(); }

    @GetMapping
    RootList list() {
        return new RootList(roots.findAll());
    }

    @PostMapping("/preview")
    Object preview(@RequestBody Location input) {
        return withLocationErrorMapping(() -> registration.preview(input.path()));
    }

    @PostMapping
    LibraryRoot create(@RequestBody Registration input) {
        return withLocationErrorMapping(() -> registration.create(
                input.name(), input.path(), input.expectedFingerprint(), input.idempotencyKey()));
    }

    @PostMapping("/check")
    RootList check() {
        return withLocationErrorMapping(() -> {
            capabilities.checkAll();
            if (!content.scanAll()) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                        "CONTENT_SCAN_FAILED", "文章或加密书库目录扫描未完成，请检查目录可读性后重试。");
            }
            return new RootList(roots.findAll());
        });
    }

    private <T> T withLocationErrorMapping(Supplier<T> action) {
        try {
            return action.get();
        } catch (IllegalArgumentException error) {
            String message = error.getMessage() == null || error.getMessage().isBlank() ? "书库路径无效。" : error.getMessage();
            throw ApiException.badRequest("INVALID_LIBRARY_LOCATION", message);
        }
    }

    public record Location(String path) {}
    public record Registration(String name, String path, String expectedFingerprint, UUID idempotencyKey) {}
    public record RootList(List<LibraryRoot> items) {}
}
