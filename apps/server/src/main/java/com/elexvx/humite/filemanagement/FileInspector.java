package com.elexvx.humite.filemanagement;

import com.elexvx.humite.catalog.BookFormat;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Locale;
import java.util.zip.ZipFile;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.apache.pdfbox.Loader;
import org.springframework.stereotype.Component;

@Component
// 区分可解析性与加密、DRM、数字签名标志，后者限制写回资格。
// Separates parseability from encryption, DRM and digital-signature flags that constrain writeback eligibility.
public class FileInspector {
    private static final int MAX_XML_BYTES = 5 * 1024 * 1024;
    private static final int MAX_EPUB_ENTRIES = 20_000;
    private static final long MAX_EPUB_UNCOMPRESSED_BYTES = 4L * 1024 * 1024 * 1024;

    public Inspection inspect(Path path, BookFormat format) throws IOException {
        return switch (format) {
            case EPUB -> inspectEpub(path);
            case PDF -> inspectPdf(path);
        };
    }

    public void assertReadable(Path path, BookFormat format) throws IOException {
        Inspection inspection = inspect(path, format);
        if (!inspection.parseable()) throw new IOException("文件无法被解析");
    }

    private Inspection inspectEpub(Path path) throws IOException {
        try (ZipFile zip = new ZipFile(path.toFile(), StandardCharsets.UTF_8)) {
            long declaredBytes = 0;
            long actualBytes = 0;
            int entries = 0;
            long compressedSize = Math.max(1L, java.nio.file.Files.size(path));
            long ratioLimit = Math.max(256L * 1024 * 1024,
                    Math.min(MAX_EPUB_UNCOMPRESSED_BYTES, compressedSize > MAX_EPUB_UNCOMPRESSED_BYTES / 250
                            ? MAX_EPUB_UNCOMPRESSED_BYTES : compressedSize * 250));
            long maxAllowedBytes = Math.min(ratioLimit, MAX_EPUB_UNCOMPRESSED_BYTES);
            byte[] drainBuffer = new byte[32_768];
            boolean drm = false;
            var enumeration = zip.entries();
            while (enumeration.hasMoreElements()) {
                var entry = enumeration.nextElement();
                entries++;
                if (entries > MAX_EPUB_ENTRIES) throw new IOException("EPUB 条目数量超过安全限制");
                if (entry.getSize() > 0) {
                    declaredBytes = Math.addExact(declaredBytes, entry.getSize());
                    if (declaredBytes > maxAllowedBytes) {
                        throw new IOException("EPUB 解压大小超过安全限制");
                    }
                }
                if (entry.getName().toLowerCase(Locale.ROOT).contains("rights.xml")) {
                    drm = true;
                }
                if (!entry.isDirectory()) {
                    try (InputStream input = zip.getInputStream(entry)) {
                        actualBytes += copyBounded(input, OutputStream.nullOutputStream(),
                                maxAllowedBytes - actualBytes, "EPUB 解压大小超过安全限制", drainBuffer);
                    }
                }
            }
            var mimetype = zip.getEntry("mimetype");
            var container = zip.getEntry("META-INF/container.xml");
            boolean parseable = mimetype != null && container != null;
            boolean signed = zip.getEntry("META-INF/signatures.xml") != null;
            boolean encrypted = zip.getEntry("META-INF/encryption.xml") != null;
            if (container != null) {
                try (var input = zip.getInputStream(container)) {
                    var factory = secureXmlFactory();
                    byte[] bytes = readBounded(input, MAX_XML_BYTES, "EPUB container.xml 超过安全限制");
                    factory.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
                } catch (Exception exception) {
                    parseable = false;
                }
            }
            return new Inspection(parseable, encrypted, drm, signed);
        }
    }

    static byte[] readBounded(InputStream input, int maxBytes, String exceededMessage) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
        copyBounded(input, output, maxBytes, exceededMessage, new byte[8192]);
        return output.toByteArray();
    }

    static long copyBounded(InputStream input, OutputStream output, long maxBytes, String exceededMessage)
            throws IOException {
        return copyBounded(input, output, maxBytes, exceededMessage, new byte[32_768]);
    }

    private static long copyBounded(InputStream input, OutputStream output, long maxBytes, String exceededMessage,
                                    byte[] buffer) throws IOException {
        long total = 0;
        while (true) {
            int toRead = (int) Math.min(buffer.length, Math.max(0L, maxBytes - total));
            if (toRead == 0) {
                if (input.read() != -1) {
                    throw new IOException(exceededMessage);
                }
                return total;
            }
            int read = input.read(buffer, 0, toRead);
            if (read < 0) {
                return total;
            }
            if (read > 0) {
                output.write(buffer, 0, read);
                total += read;
            }
        }
    }

    private Inspection inspectPdf(Path path) throws IOException {
        try (var document = Loader.loadPDF(path.toFile())) {
            return new Inspection(true, document.isEncrypted(), false, !document.getSignatureDictionaries().isEmpty());
        } catch (org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException exception) {
            return new Inspection(true, true, false, false);
        }
    }

    public static DocumentBuilderFactory secureXmlFactory() throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        return factory;
    }

    public record Inspection(boolean parseable, boolean encrypted, boolean drmProtected, boolean digitallySigned) {}
}
