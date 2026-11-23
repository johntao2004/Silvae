package com.elexvx.humite.catalog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.elexvx.humite.audit.AuditService;
import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.config.HumiteProperties;
import com.elexvx.humite.filemanagement.FileFingerprints;
import com.elexvx.humite.ingestion.LibraryRoot;
import com.elexvx.humite.ingestion.LibraryRootRepository;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import com.elexvx.humite.users.UserRole;
import com.elexvx.humite.users.UserStatus;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import java.util.zip.CRC32;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BookCoverServiceTest {
    @TempDir
    Path rootDir;

    @Test
    void rejectsOversizedDimensionPngViaImageReaderBeforeDecodingPixels() throws Exception {
        byte[] pixelBombPng = pngHeaderOnly(13_000, 13_000);
        var fixture = fixture();

        ApiException error = assertThrows(ApiException.class,
                () -> fixture.service.upload(fixture.bookId, pixelBombPng, () -> "owner"));
        assertEquals("INVALID_COVER", error.code());
        verifyNoInteractions(fixture.covers);
    }

    @Test
    void normalizesValidCoverTo800x1200AndActivates() throws Exception {
        var fixture = fixture();
        BufferedImage input = new BufferedImage(100, 150, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(input, "PNG", out);

        fixture.service.upload(fixture.bookId, out.toByteArray(), () -> "owner");

        verify(fixture.covers).activate(eq(fixture.bookId), eq(fixture.rootId), anyString(), anyString(),
                eq(800), eq(1200), eq(fixture.actorId));
        assertTrue(rootDir.resolve(".humite-assets/covers/" + fixture.bookId).toFile().exists());
    }

    private Fixture fixture() throws Exception {
        UUID actorId = UUID.randomUUID();
        UUID bookId = UUID.randomUUID();
        UUID rootId = UUID.randomUUID();
        BookRepository books = mock(BookRepository.class);
        BookCoverRepository covers = mock(BookCoverRepository.class);
        LibraryRootRepository roots = mock(LibraryRootRepository.class);
        UserRepository users = mock(UserRepository.class);
        when(users.findByUsername("owner")).thenReturn(Optional.of(
                new HumiteUser(actorId, "owner", "Owner", "hash", UserRole.OWNER, UserStatus.ACTIVE, false, null, null)));
        when(books.findPreferredFile(bookId)).thenReturn(Optional.of(
                new BookFile(UUID.randomUUID(), bookId, rootId, "book.epub", BookFormat.EPUB, BookFileStatus.AVAILABLE,
                        1024L, OffsetDateTime.now(), "sha256:abc", false, false, false)));
        when(roots.findById(rootId)).thenReturn(Optional.of(
                new LibraryRoot(rootId, "main", rootDir.toString(), rootDir.toRealPath().toString(),
                        LibraryRoot.RootStatus.ONLINE, true, true, true, true, null, null, null)));
        BookCoverService service = new BookCoverService(books, covers, roots, users,
                new FileFingerprints(), new HumiteProperties(null, null, null, null, null, null, null, null, null, null, null),
                mock(AuditService.class));
        return new Fixture(actorId, bookId, rootId, covers, service);
    }

    private static byte[] pngHeaderOnly(int width, int height) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A});
        byte[] ihdrData = ByteBuffer.allocate(13)
                .putInt(width)
                .putInt(height)
                .put((byte) 8)
                .put((byte) 2)
                .put((byte) 0)
                .put((byte) 0)
                .put((byte) 0)
                .array();
        writeChunk(out, new byte[]{'I', 'H', 'D', 'R'}, ihdrData);
        writeChunk(out, new byte[]{'I', 'E', 'N', 'D'}, new byte[0]);
        return out.toByteArray();
    }

    private static void writeChunk(ByteArrayOutputStream out, byte[] type, byte[] data) throws Exception {
        out.write(ByteBuffer.allocate(4).putInt(data.length).array());
        out.write(type);
        out.write(data);
        CRC32 crc = new CRC32();
        crc.update(type);
        crc.update(data);
        out.write(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
    }

    private record Fixture(UUID actorId, UUID bookId, UUID rootId, BookCoverRepository covers, BookCoverService service) {}
}
