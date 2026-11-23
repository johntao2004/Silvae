package com.elexvx.humite.filemanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.elexvx.humite.audit.AuditService;
import com.elexvx.humite.catalog.BookFile;
import com.elexvx.humite.catalog.BookFileStatus;
import com.elexvx.humite.catalog.BookFormat;
import com.elexvx.humite.catalog.BookRepository;
import com.elexvx.humite.config.HumiteProperties;
import com.elexvx.humite.filemanagement.FileOperationRepository.ExecutionRecord;
import com.elexvx.humite.ingestion.LibraryRoot;
import com.elexvx.humite.ingestion.LibraryRootRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class FileTransactionExecutorTest {
    @Test
    void restoresInterruptFlagWhenInterruptedDuringLeaseWait() {
        UUID opId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID fileId = UUID.randomUUID();
        UUID bookId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();

        var operations = mock(FileOperationRepository.class);
        var books = mock(BookRepository.class);
        var leases = mock(FileLeaseRepository.class);
        var audit = mock(AuditService.class);
        var file = new BookFile(fileId, bookId, rootId, "book.epub", BookFormat.EPUB, BookFileStatus.OPERATING,
                10L, OffsetDateTime.now(), "sha256:fp", false, false, false);
        when(books.findFile(fileId)).thenReturn(Optional.of(file));
        when(leases.tryAcquireWrite(eq(fileId), anyString(), any())).thenAnswer(invocation -> {
            Thread.currentThread().interrupt();
            return Optional.empty();
        });

        var properties = new HumiteProperties(null, null, Duration.ofSeconds(2), null, null, null, null,
                null, null, null, null);
        var executor = new FileTransactionExecutor(operations, books, mock(LibraryRootRepository.class),
                mock(RecycleBinRepository.class), mock(FileVersionRepository.class), leases,
                new FileFingerprints(), mock(FileInspector.class), mock(MetadataWriteService.class),
                audit, properties, new PathPolicy());
        var record = new ExecutionRecord(opId, actorId, FileOperationType.RENAME, fileId, null, null,
                rootId, rootId, "old.epub", "new.epub", "sha256:fp");

        try {
            executor.execute(record);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
            verify(operations).fail(eq(opId), eq("OPERATION_INTERRUPTED"), anyString());
            verify(books).updateFileStatus(fileId, BookFileStatus.AVAILABLE);
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void afterCompletionHandlesNullBookFileIdWithoutNullPointerException() {
        UUID opId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        var operations = mock(FileOperationRepository.class);
        var books = mock(BookRepository.class);
        var audit = mock(AuditService.class);
        var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null, null);
        var executor = new FileTransactionExecutor(operations, books, mock(LibraryRootRepository.class),
                mock(RecycleBinRepository.class), mock(FileVersionRepository.class), mock(FileLeaseRepository.class),
                new FileFingerprints(), mock(FileInspector.class), mock(MetadataWriteService.class),
                audit, properties, new PathPolicy());
        var record = new ExecutionRecord(opId, actorId, FileOperationType.RESTORE, null, null, null,
                null, null, "src", "dst", "sha256:fp");

        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            executor.execute(record);
            for (TransactionSynchronization sync : TransactionSynchronizationManager.getSynchronizations()) {
                sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
            }
            verify(audit).recordIndependent(eq(actorId), eq("RESTORE"), eq("BOOK_FILE"), isNull(),
                    eq("src"), eq("dst"), eq("sha256:fp"), isNull(), eq("FAILED"), anyString());
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }

    @Test
    void restoresVersionFileSafely(@TempDir Path rootPath) throws Exception {
        Path realRoot = rootPath.toRealPath();
        UUID opId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID fileId = UUID.randomUUID();
        UUID bookId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();

        Path current = realRoot.resolve("Author/book.epub");
        Files.createDirectories(current.getParent());
        Files.writeString(current, "current-bytes");
        String currentFp = new FileFingerprints().sha256(current);

        String versionRel = ".humite-versions/" + fileId + "/v1-book.epub";
        Path archived = realRoot.resolve(versionRel);
        Files.createDirectories(archived.getParent());
        Files.writeString(archived, "restored-bytes");
        String versionFp = new FileFingerprints().sha256(archived);

        var file = new BookFile(fileId, bookId, rootId, "Author/book.epub", BookFormat.EPUB, BookFileStatus.OPERATING,
                Files.size(current), OffsetDateTime.now(), currentFp, false, false, false);
        var root = new LibraryRoot(rootId, "root", realRoot.toString(), realRoot.toString(), LibraryRoot.RootStatus.ONLINE,
                true, true, true, true, null, null, null);
        var version = new FileVersionRepository.FileVersion(versionId, fileId, rootId, versionRel, "Author/book.epub",
                versionFp, Files.size(archived), "MANUAL", actorId, OffsetDateTime.now(),
                OffsetDateTime.now().plusDays(1), null);

        var operations = mock(FileOperationRepository.class);
        var books = mock(BookRepository.class);
        var roots = mock(LibraryRootRepository.class);
        var versions = mock(FileVersionRepository.class);
        var leases = mock(FileLeaseRepository.class);
        when(books.findFile(fileId)).thenReturn(Optional.of(file));
        when(roots.findById(rootId)).thenReturn(Optional.of(root));
        when(versions.find(versionId)).thenReturn(Optional.of(version));
        when(leases.tryAcquireWrite(eq(fileId), anyString(), any()))
                .thenReturn(Optional.of(new FileLeaseRepository.Lease(fileId, "op")));

        var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null, null);
        var executor = new FileTransactionExecutor(operations, books, roots, mock(RecycleBinRepository.class),
                versions, leases, new FileFingerprints(), mock(FileInspector.class), mock(MetadataWriteService.class),
                mock(AuditService.class), properties, new PathPolicy());
        var record = new ExecutionRecord(opId, actorId, FileOperationType.RESTORE, fileId, null, versionId,
                rootId, rootId, "Author/book.epub", "Author/book.epub", currentFp);

        executor.execute(record);

        assertThat(Files.readString(current)).isEqualTo("restored-bytes");
        verify(operations).succeed(opId, versionFp);
        verify(versions).markRestored(versionId);
    }
}
