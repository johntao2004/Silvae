package com.elexvx.humite.filemanagement;

import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.filemanagement.FileOperationModels.ExecuteRequest;
import com.elexvx.humite.filemanagement.FileOperationModels.FileVersionList;
import com.elexvx.humite.filemanagement.FileOperationModels.Operation;
import com.elexvx.humite.filemanagement.FileOperationModels.Preview;
import com.elexvx.humite.filemanagement.FileOperationModels.PreviewRequest;
import com.elexvx.humite.filemanagement.FileOperationModels.VersionRestorePreviewRequest;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("api")
@RequestMapping("/api/v1/file-operations")
@PreAuthorize("hasAnyRole('OWNER','ADMIN')")
// 管理角色的预览与入队接口；返回任务记录不代表后台文件操作已完成。
// Management endpoints for preview and enqueueing; a returned job record does not mean filesystem work has finished.
public class FileOperationController {
    private final FileOperationService service;
    private final FileOperationRepository operations;

    public FileOperationController(FileOperationService service, FileOperationRepository operations) {
        this.service = service;
        this.operations = operations;
    }

    @PostMapping("/preview")
    Preview preview(@Valid @RequestBody PreviewRequest request, Principal principal) {
        return service.preview(request, principal);
    }

    @PostMapping
    Operation execute(@Valid @RequestBody ExecuteRequest request,
                      @RequestHeader("Idempotency-Key") String idempotencyKey,
                      Principal principal) {
        return service.execute(request, idempotencyKey, principal);
    }

    @GetMapping("/book-files/{bookFileId}/versions")
    FileVersionList versions(@PathVariable UUID bookFileId, Principal principal) {
        return service.listVersions(bookFileId, principal);
    }

    @PostMapping("/versions/{versionId}/restore/preview")
    Preview previewVersionRestore(@PathVariable UUID versionId,
                                  @Valid @RequestBody VersionRestorePreviewRequest request,
                                  Principal principal) {
        return service.previewVersionRestore(versionId, request.expectedFingerprint(), principal);
    }

    @PostMapping("/versions/{versionId}/restore")
    Operation restoreVersion(@PathVariable UUID versionId, @Valid @RequestBody ExecuteRequest request,
                             @RequestHeader("Idempotency-Key") String idempotencyKey, Principal principal) {
        return service.executeForVersion(versionId, request, idempotencyKey, principal);
    }

    @GetMapping("/{id}")
    Operation get(@PathVariable UUID id) {
        return operations.find(id).orElseThrow(() -> ApiException.notFound("OPERATION_NOT_FOUND", "文件任务不存在。"));
    }
}
