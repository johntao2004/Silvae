package com.elexvx.humite.filemanagement;

import static org.junit.jupiter.api.Assertions.assertThrows;

import com.elexvx.humite.catalog.BookMetadataRepository.BookMetadata;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class EpubMetadataWriterTest {
    @TempDir
    Path temporary;

    @Test
    void rejectsOversizedMimetypeEntryBeforeExhaustingMemory() throws Exception {
        Path source = temporary.resolve("oversized-mimetype.epub");
        Path target = temporary.resolve("out.epub");
        try (ZipOutputStream output = new ZipOutputStream(Files.newOutputStream(source), StandardCharsets.UTF_8)) {
            output.putNextEntry(new ZipEntry("mimetype"));
            output.write("a".repeat(8192).getBytes(StandardCharsets.UTF_8));
            output.closeEntry();
            output.putNextEntry(new ZipEntry("META-INF/container.xml"));
            output.write("<container><rootfiles><rootfile full-path='book.opf'/></rootfiles></container>"
                    .getBytes(StandardCharsets.UTF_8));
            output.closeEntry();
            output.putNextEntry(new ZipEntry("book.opf"));
            output.write("<package><metadata/></package>".getBytes(StandardCharsets.UTF_8));
            output.closeEntry();
        }
        BookMetadata metadata = new BookMetadata(UUID.randomUUID(), "标题", null, List.of("作者"), List.of(),
                "zh", null, null, null, null, null, null, List.of(), List.of(), null, null, Map.of(), false, null, null);
        assertThrows(IOException.class, () -> new EpubMetadataWriter().write(source, target, metadata, temporary));
    }

    @Test
    void rejectsOversizedOpfEntryWithExplicitLimit() throws Exception {
        Path source = temporary.resolve("oversized-opf.epub");
        Path target = temporary.resolve("out-opf.epub");
        try (ZipOutputStream output = new ZipOutputStream(Files.newOutputStream(source), StandardCharsets.UTF_8)) {
            output.putNextEntry(new ZipEntry("mimetype"));
            output.write("application/epub+zip".getBytes(StandardCharsets.UTF_8));
            output.closeEntry();
            output.putNextEntry(new ZipEntry("META-INF/container.xml"));
            output.write("<container><rootfiles><rootfile full-path='book.opf'/></rootfiles></container>"
                    .getBytes(StandardCharsets.UTF_8));
            output.closeEntry();
            output.putNextEntry(new ZipEntry("book.opf"));
            byte[] block = " ".repeat(1024 * 1024).getBytes(StandardCharsets.UTF_8);
            for (int i = 0; i < 6; i++) {
                output.write(block);
            }
            output.closeEntry();
        }
        BookMetadata metadata = new BookMetadata(UUID.randomUUID(), "标题", null, List.of("作者"), List.of(),
                "zh", null, null, null, null, null, null, List.of(), List.of(), null, null, Map.of(), false, null, null);
        assertThrows(IOException.class, () -> new EpubMetadataWriter().write(source, target, metadata, temporary));
    }
}
