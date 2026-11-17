package com.elexvx.humite.ingestion.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.elexvx.humite.audit.AuditService;
import com.elexvx.humite.catalog.BookFormat;
import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.filemanagement.PathPolicy;
import com.elexvx.humite.ingestion.upload.BookUploadModels.BookUploadStatus;
import com.elexvx.humite.ingestion.upload.BookUploadModels.MetadataDraft;
import com.elexvx.humite.ingestion.upload.BookUploadModels.MetadataSource;
import com.elexvx.humite.ingestion.upload.BookUploadModels.UploadEntity;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;

class BookUploadLanguageValidationTest {
    @Test
    void acceptsAndPersistsLongCommaSeparatedLanguageDraftsButRejectsValuesOver1024Characters() {
        UUID ownerId = UUID.randomUUID();
        UUID uploadId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        var uploads = mock(BookUploadRepository.class);
        var users = mock(UserRepository.class);
        var owner = mock(HumiteUser.class);
        when(owner.id()).thenReturn(ownerId);
        when(users.findByUsername("owner")).thenReturn(Optional.of(owner));

        OffsetDateTime now = OffsetDateTime.now();
        var existing = draft("zh-CN");
        var upload = new UploadEntity(uploadId, ownerId, rootId, "test-root", "upload.epub",
                ".humite-staging/uploads/" + uploadId + "/book.part", BookFormat.EPUB, 4, 4,
                "sha256:test", BookUploadStatus.READY_FOR_REVIEW, false, false, false, existing, existing,
                List.of(), null, null, null, null, List.of(), existing.targetPath(), null, null, null, null,
                now.plusDays(1), now, now);
        when(uploads.findOwned(uploadId, ownerId)).thenReturn(Optional.of(upload));
        when(uploads.updateDraft(eq(uploadId), any())).thenReturn(true);
        var service = new BookUploadService(uploads, null, null, null, null, null, null, users, null, null,
                new PathPolicy(), null, mock(AuditService.class), new ObjectMapper(), null);

        String atLimit = String.join(",", Collections.nCopies(340, "en")) + ",abcd";
        assertThat(atLimit).hasSize(1024);
        service.updateDraft(uploadId, draft(atLimit), () -> "owner");
        var saved = ArgumentCaptor.forClass(MetadataDraft.class);
        verify(uploads).updateDraft(eq(uploadId), saved.capture());
        assertThat(saved.getValue().language()).isEqualTo(atLimit);

        clearInvocations(uploads);
        assertThatThrownBy(() -> service.updateDraft(uploadId, draft(atLimit + "x"), () -> "owner"))
                .isInstanceOf(ApiException.class);
        verify(uploads, never()).updateDraft(eq(uploadId), any());
    }

    private MetadataDraft draft(String language) {
        return new MetadataDraft("Title", null, List.of("Author"), List.of(), language, null, null, null,
                null, null, null, List.of(), null, null, Map.of("language", MetadataSource.MANUAL),
                "Author/Title.epub", true, List.of(), null, null);
    }
}
