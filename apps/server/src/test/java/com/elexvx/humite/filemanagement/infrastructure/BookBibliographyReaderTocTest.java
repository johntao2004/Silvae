package com.elexvx.humite.filemanagement.infrastructure;

import static org.junit.jupiter.api.Assertions.*;
import com.elexvx.humite.catalog.BookFormat;
import com.elexvx.humite.common.ApiException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.*;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageFitDestination;

class BookBibliographyReaderTocTest {
    @TempDir Path temporaryDirectory;

    @ParameterizedTest
    @ValueSource(strings = {"", "reader-password"})
    void encryptedPdfExplainsTheLimitationWithoutChangingTheSource(String password) throws Exception {
        var path = temporaryDirectory.resolve("encrypted.pdf");
        try (var document = new PDDocument()) {
            document.addPage(new PDPage());
            document.protect(new StandardProtectionPolicy("owner-password", password, new AccessPermission()));
            document.save(path.toFile());
        }
        var original = Files.readAllBytes(path);

        var failure = assertThrows(ApiException.class, () -> new BookBibliographyReader().read(path, BookFormat.PDF));

        assertEquals(422, failure.status().value());
        assertEquals("BIBLIOGRAPHY_PDF_ENCRYPTED", failure.code());
        assertEquals("PDF 已加密，无法读取补充资料。", failure.getMessage());
        assertArrayEquals(original, Files.readAllBytes(path));
    }

    @Test void recognizesSourcePageIndexAndKeepsAll340Entries() throws Exception {
        try (var document = new PDDocument()) {
            var outline = new PDDocumentOutline();
            document.getDocumentCatalog().setDocumentOutline(outline);
            for (int i = 0; i < 347; i++) document.addPage(new PDPage());
            for (int i = 1; i <= 340; i++) {
                var item = new PDOutlineItem(); item.setTitle(String.valueOf(i));
                var destination = new PDPageFitDestination(); destination.setPage(document.getPage(i + 6));
                item.setDestination(destination); outline.addLast(item);
            }
            var contents = new BookBibliographyReader().pdfContents(document);
            assertEquals(340, contents.lines().count());
            assertTrue(contents.startsWith("第 1 页\n第 2 页"));
            assertTrue(contents.endsWith("第 340 页"));
        }
    }
    @Test void retainsNumberedChaptersSpanningMultiplePages() throws Exception {
        try (var document = new PDDocument()) {
            var outline = new PDDocumentOutline(); document.getDocumentCatalog().setDocumentOutline(outline);
            for (int i = 0; i < 40; i++) document.addPage(new PDPage());
            for (int i = 1; i <= 10; i++) {
                var item = new PDOutlineItem(); item.setTitle(String.valueOf(i));
                var destination = new PDPageFitDestination(); destination.setPage(document.getPage(i * 3));
                item.setDestination(destination); outline.addLast(item);
            }
            assertEquals("1\n2\n3\n4\n5\n6\n7\n8\n9\n10", new BookBibliographyReader().pdfContents(document));
        }
    }
}
