package com.elexvx.humite.ingestion.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.elexvx.humite.audit.AuditService;
import com.elexvx.humite.catalog.BookFormat;
import com.elexvx.humite.catalog.DisplayCatalogService;
import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.config.HumiteProperties;
import com.elexvx.humite.filemanagement.FileFingerprints;
import com.elexvx.humite.filemanagement.FileInspector;
import com.elexvx.humite.filemanagement.PathPolicy;
import com.elexvx.humite.ingestion.CatalogIngestionRepository;
import com.elexvx.humite.ingestion.LibraryRoot;
import com.elexvx.humite.ingestion.LibraryRootRepository;
import com.elexvx.humite.ingestion.UploadedBookIngestionService;
import com.elexvx.humite.ingestion.upload.BookUploadModels.BookUploadStatus;
import com.elexvx.humite.ingestion.upload.BookUploadModels.CoverSource;
import com.elexvx.humite.ingestion.upload.BookUploadModels.MetadataDraft;
import com.elexvx.humite.ingestion.upload.BookUploadModels.MetadataSource;
import com.elexvx.humite.ingestion.upload.BookUploadModels.UploadEntity;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import com.elexvx.humite.users.UserRole;
import com.elexvx.humite.users.UserStatus;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.zip.CRC32;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import tools.jackson.databind.ObjectMapper;

class BookUploadCommitRegressionTest {
    private static final String USERNAME = "commit-owner";

    @Test
    void rejectsImageBombCoverDimensionsBeforeDecodingBitmap(@TempDir Path rootPath) throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        UUID uploadId = UUID.randomUUID();
        var uploads = mock(BookUploadRepository.class);
        var upload = readyUpload(uploadId, ownerId, rootId, "sha256:book", null);
        when(uploads.findOwned(uploadId, ownerId)).thenReturn(Optional.of(upload));

        var service = service(uploads, roots(rootId, rootPath), mock(CatalogIngestionRepository.class),
                users(ownerId), mock(FileInspector.class), mock(DisplayCatalogService.class),
                mock(UploadedBookIngestionService.class), new RecordingTxManager());

        byte[] oversizedWidth = pngHeaderBomb(12_001, 1);
        byte[] oversizedPixels = pngHeaderBomb(10_000, 9_000);

        assertThatThrownBy(() -> service.customCover(uploadId, oversizedWidth, () -> USERNAME))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status().value()).isEqualTo(400);
                    assertThat(error.code()).isEqualTo("INVALID_COVER");
                });
        assertThatThrownBy(() -> service.customCover(uploadId, oversizedPixels, () -> USERNAME))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status().value()).isEqualTo(400);
                    assertThat(error.code()).isEqualTo("INVALID_COVER");
                });
        verify(uploads, never()).selectCover(any(), any(), any());
    }

    @Test
    void rollsBackDatabaseTransactionAndCompensatesMovedFilesWhenPublishFailsAfterCatalogCreate(@TempDir Path rootPath)
            throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        UUID uploadId = UUID.randomUUID();
        Path realRoot = rootPath.toRealPath();
        Path stagedDir = realRoot.resolve(".humite-staging/uploads/" + uploadId);
        Files.createDirectories(stagedDir);
        Path stagedBook = stagedDir.resolve("book.part");
        Files.writeString(stagedBook, "book-bytes", StandardCharsets.UTF_8);
        Path stagedCover = stagedDir.resolve("cover.jpg");
        Files.write(stagedCover, smallJpegBytes());
        String bookFingerprint = new FileFingerprints().sha256(stagedBook);

        String coverRel = ".humite-staging/uploads/" + uploadId + "/cover.jpg";
        var ready = readyUpload(uploadId, ownerId, rootId, bookFingerprint, coverRel);
        var committing = withStatus(ready, BookUploadStatus.COMMITTING, "split-brain-key");

        var uploads = mock(BookUploadRepository.class);
        when(uploads.findOwned(uploadId, ownerId)).thenReturn(Optional.of(ready));
        when(uploads.beginCommit(uploadId, ownerId, "split-brain-key")).thenReturn(committing);

        var catalog = mock(CatalogIngestionRepository.class);
        when(catalog.duplicateBookId(bookFingerprint)).thenReturn(null);
        var inspector = mock(FileInspector.class);
        when(inspector.inspect(any(Path.class), eq(BookFormat.EPUB)))
                .thenReturn(new FileInspector.Inspection(true, false, false, false));
        var display = mock(DisplayCatalogService.class);
        doThrow(new IllegalStateException("display catalog failure"))
                .when(display).publish(any(UUID.class), eq(ownerId));
        var uploadedBooks = mock(UploadedBookIngestionService.class);
        var txManager = new RecordingTxManager();

        var service = service(uploads, roots(rootId, realRoot), catalog, users(ownerId), inspector, display,
                uploadedBooks, txManager);

        assertThatThrownBy(() -> service.commit(uploadId, "split-brain-key", true, () -> USERNAME))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.code()).isEqualTo("UPLOAD_COMMIT_FAILED"));

        assertThat(txManager.begun).isEqualTo(1);
        assertThat(txManager.rolledBack).isEqualTo(1);
        assertThat(txManager.committed).isZero();
        assertThat(Files.exists(stagedBook)).isTrue();
        assertThat(Files.exists(stagedCover)).isTrue();
        assertThat(Files.exists(realRoot.resolve("Author/Book Title.epub"))).isFalse();
        verify(uploads, never()).succeeded(any(), any());
        verify(uploads).resetReady(eq(uploadId), eq("COMMIT_FAILED"), any());
    }

    @Test
    void commitsSingleDatabaseTransactionWhenAllStepsSucceed(@TempDir Path rootPath) throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        UUID uploadId = UUID.randomUUID();
        Path realRoot = rootPath.toRealPath();
        Path stagedDir = realRoot.resolve(".humite-staging/uploads/" + uploadId);
        Files.createDirectories(stagedDir);
        Path stagedBook = stagedDir.resolve("book.part");
        Files.writeString(stagedBook, "book-bytes", StandardCharsets.UTF_8);
        String bookFingerprint = new FileFingerprints().sha256(stagedBook);

        var ready = readyUpload(uploadId, ownerId, rootId, bookFingerprint, null);
        var committing = withStatus(ready, BookUploadStatus.COMMITTING, "happy-key");
        var succeeded = withStatus(ready, BookUploadStatus.SUCCEEDED, "happy-key");

        var uploads = mock(BookUploadRepository.class);
        when(uploads.findOwned(uploadId, ownerId)).thenReturn(Optional.of(ready), Optional.of(succeeded));
        when(uploads.beginCommit(uploadId, ownerId, "happy-key")).thenReturn(committing);

        var catalog = mock(CatalogIngestionRepository.class);
        when(catalog.duplicateBookId(bookFingerprint)).thenReturn(null);
        var inspector = mock(FileInspector.class);
        when(inspector.inspect(any(Path.class), eq(BookFormat.EPUB)))
                .thenReturn(new FileInspector.Inspection(true, false, false, false));
        var display = mock(DisplayCatalogService.class);
        var uploadedBooks = mock(UploadedBookIngestionService.class);
        var txManager = new RecordingTxManager();

        var service = service(uploads, roots(rootId, realRoot), catalog, users(ownerId), inspector, display,
                uploadedBooks, txManager);

        var result = service.commit(uploadId, "happy-key", true, (Principal) () -> USERNAME);

        assertThat(result.status()).isEqualTo(BookUploadStatus.SUCCEEDED);
        assertThat(txManager.begun).isEqualTo(1);
        assertThat(txManager.committed).isEqualTo(1);
        assertThat(txManager.rolledBack).isZero();
        assertThat(Files.exists(realRoot.resolve("Author/Book Title.epub"))).isTrue();
        assertThat(Files.exists(stagedBook)).isFalse();
        verify(uploadedBooks).createUploaded(any(), eq(ownerId), eq(rootId), eq("Author/Book Title.epub"),
                eq("author/book title.epub"), eq(BookFormat.EPUB), any(), eq(bookFingerprint), any(), any(),
                any(), any(), any(), any(), any());
        verify(display).publish(any(UUID.class), eq(ownerId));
        verify(uploads).succeeded(eq(uploadId), any(UUID.class));
    }

    private static BookUploadService service(BookUploadRepository uploads, LibraryRootRepository roots,
                                             CatalogIngestionRepository catalog, UserRepository users,
                                             FileInspector inspector, DisplayCatalogService display,
                                             UploadedBookIngestionService uploadedBooks,
                                             RecordingTxManager txManager) {
        return new BookUploadService(uploads, null, null, null, null, roots, catalog, users, inspector,
                new FileFingerprints(), new PathPolicy(),
                new HumiteProperties(null, null, null, null, null, null, null, null, null, null, null),
                mock(AuditService.class), new ObjectMapper(), display, null, uploadedBooks, txManager);
    }

    private static LibraryRootRepository roots(UUID rootId, Path rootPath) {
        var repo = mock(LibraryRootRepository.class);
        when(repo.findById(rootId)).thenReturn(Optional.of(new LibraryRoot(rootId, "root", rootPath.toString(),
                rootPath.toString(), LibraryRoot.RootStatus.ONLINE, true, true, true, true, null, null, null)));
        return repo;
    }

    private static UserRepository users(UUID ownerId) {
        var repo = mock(UserRepository.class);
        when(repo.findByUsername(USERNAME)).thenReturn(Optional.of(new HumiteUser(ownerId, USERNAME, "Owner",
                "hash", UserRole.OWNER, UserStatus.ACTIVE, false, OffsetDateTime.now(), null)));
        return repo;
    }

    private static UploadEntity readyUpload(UUID uploadId, UUID ownerId, UUID rootId, String fingerprint,
                                            String coverStagingPath) {
        OffsetDateTime now = OffsetDateTime.now();
        MetadataDraft draft = new MetadataDraft("Book Title", null, List.of("Author"), List.of(), "en",
                null, null, null, null, null, null, List.of(), 10, 100L,
                Map.of("title", MetadataSource.FILE), "Author/Book Title.epub", true);
        return new UploadEntity(uploadId, ownerId, rootId, "root", "Book Title.epub",
                ".humite-staging/uploads/" + uploadId + "/book.part", BookFormat.EPUB, 10L, 10L, fingerprint,
                BookUploadStatus.READY_FOR_REVIEW, false, false, false, draft, draft, List.of(), null,
                coverStagingPath == null ? null : CoverSource.CUSTOM, coverStagingPath, null, List.of(),
                draft.targetPath(), null, null, null, null, now.plusDays(1), now, now);
    }

    private static UploadEntity withStatus(UploadEntity source, BookUploadStatus status, String idempotencyKey) {
        return new UploadEntity(source.id(), source.requestedBy(), source.libraryRootId(), source.libraryRootName(),
                source.originalFilename(), source.stagingPath(), source.format(), source.declaredSizeBytes(),
                source.receivedBytes(), source.fingerprint(), status, source.encrypted(), source.drmProtected(),
                source.digitallySigned(), source.detectedMetadata(), source.draftMetadata(), source.metadataCandidates(),
                source.coverCacheKey(), source.selectedCoverSource(), source.selectedCoverStagingPath(),
                source.duplicateBookId(), source.similarBookIds(), source.targetPath(), source.errorCode(),
                source.errorDetail(), idempotencyKey, source.committedBookId(), source.expiresAt(),
                source.createdAt(), source.updatedAt());
    }

    private static byte[] pngHeaderBomb(int width, int height) throws Exception {
        var out = new ByteArrayOutputStream();
        var data = new DataOutputStream(out);
        data.write(new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A});
        data.writeInt(13);
        byte[] ihdr = new byte[17];
        ihdr[0] = 'I';
        ihdr[1] = 'H';
        ihdr[2] = 'D';
        ihdr[3] = 'R';
        putInt(ihdr, 4, width);
        putInt(ihdr, 8, height);
        ihdr[12] = 8;
        ihdr[13] = 2;
        data.write(ihdr);
        CRC32 crc = new CRC32();
        crc.update(ihdr);
        data.writeInt((int) crc.getValue());
        data.writeInt(0);
        data.write(new byte[] {'I', 'E', 'N', 'D', (byte) 0xAE, 0x42, 0x60, (byte) 0x82});
        return out.toByteArray();
    }

    private static void putInt(byte[] target, int offset, int value) {
        target[offset] = (byte) (value >>> 24);
        target[offset + 1] = (byte) (value >>> 16);
        target[offset + 2] = (byte) (value >>> 8);
        target[offset + 3] = (byte) value;
    }

    private static byte[] smallJpegBytes() throws Exception {
        var image = new java.awt.image.BufferedImage(10, 15, java.awt.image.BufferedImage.TYPE_INT_RGB);
        var out = new ByteArrayOutputStream();
        javax.imageio.ImageIO.write(image, "JPEG", out);
        return out.toByteArray();
    }

    private static final class RecordingTxManager extends AbstractPlatformTransactionManager {
        private int begun;
        private int committed;
        private int rolledBack;

        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {
            begun++;
        }

        @Override
        protected void doCommit(DefaultTransactionStatus status) {
            committed++;
        }

        @Override
        protected void doRollback(DefaultTransactionStatus status) {
            rolledBack++;
        }
    }
}
