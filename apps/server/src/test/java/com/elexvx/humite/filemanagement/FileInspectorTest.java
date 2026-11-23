// 覆盖签名、加密 EPUB 与超大容器描述，确保解析前的输入边界得到验证。
// Covers signed/encrypted EPUBs and oversized container descriptions to verify parser input limits.
package com.elexvx.humite.filemanagement;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.elexvx.humite.catalog.BookFormat;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FileInspectorTest {
    @TempDir
    Path temporary;

    @Test
    void identifiesSignedAndEncryptedEpub() throws Exception {
        Path epub = temporary.resolve("protected.epub");
        try (ZipOutputStream output = new ZipOutputStream(Files.newOutputStream(epub))) {
            stored(output, "mimetype", "application/epub+zip");
            entry(output, "META-INF/container.xml", "<container xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"book.opf\"/></rootfiles></container>");
            entry(output, "META-INF/signatures.xml", "<signatures/>");
            entry(output, "META-INF/encryption.xml", "<encryption/>");
            entry(output, "book.opf", "<package/>");
        }
        var inspection = new FileInspector().inspect(epub, BookFormat.EPUB);
        assertTrue(inspection.parseable());
        assertTrue(inspection.encrypted());
        assertTrue(inspection.digitallySigned());
        assertFalse(inspection.drmProtected());
    }

    @Test
    void rejectsOversizedContainerXmlWithoutExpandingItInTheParser() throws Exception {
        Path epub = temporary.resolve("oversized-container.epub");
        try (ZipOutputStream output = new ZipOutputStream(Files.newOutputStream(epub))) {
            stored(output, "mimetype", "application/epub+zip");
            entry(output, "META-INF/container.xml", "x".repeat(5 * 1024 * 1024 + 1));
        }
        var inspection = new FileInspector().inspect(epub, BookFormat.EPUB);
        assertFalse(inspection.parseable());
    }

    @Test
    void rejectsZipBombWhoseDeclaredHeaderSizeIsSpoofedBelowActualDecompressedSize() throws Exception {
        Path epub = temporary.resolve("spoofed-bomb.epub");
        int declaredBombSize = 257 * 1024 * 1024;
        try (ZipOutputStream output = new ZipOutputStream(Files.newOutputStream(epub))) {
            stored(output, "mimetype", "application/epub+zip");
            entry(output, "META-INF/container.xml",
                    "<container xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"book.opf\"/></rootfiles></container>");
            output.putNextEntry(new ZipEntry("OPS/bomb.xhtml"));
            byte[] zeros = new byte[1024 * 1024];
            for (int written = 0; written < declaredBombSize; written += zeros.length) {
                output.write(zeros);
            }
            output.closeEntry();
        }
        byte[] rawZip = Files.readAllBytes(epub);
        spoofUncompressedSize(rawZip, declaredBombSize, 10);
        Files.write(epub, rawZip);

        assertThrows(IOException.class, () -> new FileInspector().inspect(epub, BookFormat.EPUB));
    }

    private static void spoofUncompressedSize(byte[] zipBytes, int actualSize, int spoofedSize) {
        byte[] target = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(actualSize).array();
        byte[] replacement = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(spoofedSize).array();
        for (int i = 0; i <= zipBytes.length - 4; i++) {
            if (zipBytes[i] == target[0] && zipBytes[i + 1] == target[1]
                    && zipBytes[i + 2] == target[2] && zipBytes[i + 3] == target[3]) {
                System.arraycopy(replacement, 0, zipBytes, i, 4);
            }
        }
    }

    private void entry(ZipOutputStream output, String name, String value) throws Exception {
        output.putNextEntry(new ZipEntry(name));
        output.write(value.getBytes(StandardCharsets.UTF_8));
        output.closeEntry();
    }

    private void stored(ZipOutputStream output, String name, String value) throws Exception {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        CRC32 crc = new CRC32();
        crc.update(bytes);
        ZipEntry entry = new ZipEntry(name);
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(bytes.length);
        entry.setCompressedSize(bytes.length);
        entry.setCrc(crc.getValue());
        output.putNextEntry(entry);
        output.write(bytes);
        output.closeEntry();
    }
}
