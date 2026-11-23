package com.elexvx.humite.reading;

import com.elexvx.humite.annotations.AnnotationRepository;
import com.elexvx.humite.catalog.BookFile;
import com.elexvx.humite.catalog.BookRepository;
import com.elexvx.humite.catalog.DisplayCatalogService;
import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.filemanagement.infrastructure.BookTextSampler;
import com.elexvx.humite.filemanagement.infrastructure.KnowledgeTextGateway;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/** Extracts clean sentence excerpts from inventory books (annotations, full text, or description). */
@Service
public class BookExcerptService {
    private static final int MAX_CACHE_ENTRIES = 128;
    private static final int MAX_QUOTES = 16;
    private static final Pattern NOISE = Pattern.compile(
            "(?i)(https?://|www\\.|isbn|copyright|all rights reserved|版权所有|出版发行|印刷装订|cip数据|定价|字数|千字|第[一二三四五六七八九十百千万0-9]+[章节回篇卷节]|目\\s*录|contents)");
    private static final Pattern SENTENCE_SPLIT = Pattern.compile("(?<=[。！？；!?])|(?<=[.])\\s+|\\r?\\n+");

    private final BookRepository books;
    private final DisplayCatalogService display;
    private final AnnotationRepository annotations;
    private final KnowledgeTextGateway text;
    private final Map<String, List<String>> fileExcerptCache = Collections.synchronizedMap(
            new LinkedHashMap<>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, List<String>> eldest) {
                    return size() > MAX_CACHE_ENTRIES;
                }
            });

    public BookExcerptService(BookRepository books, DisplayCatalogService display,
                              AnnotationRepository annotations, KnowledgeTextGateway text) {
        this.books = books;
        this.display = display;
        this.annotations = annotations;
        this.text = text;
    }

    public ExcerptResponse extractForUser(UUID bookId, UUID userId) {
        if (userId != null) {
            List<String> userQuotes = extractAnnotationQuotes(userId, bookId);
            if (!userQuotes.isEmpty()) {
                return new ExcerptResponse(bookId, userQuotes, "annotation");
            }
        }
        BookFile file = books.findPreferredFile(bookId)
                .orElseThrow(() -> ApiException.notFound("BOOK_NOT_FOUND", "未找到这本书。"));
        List<String> bookQuotes = extractFromFile(file);
        if (!bookQuotes.isEmpty()) {
            return new ExcerptResponse(bookId, bookQuotes, "book");
        }
        if (userId != null) {
            List<String> descQuotes = books.findSummary(userId, bookId)
                    .map(summary -> extractSentences(summary.description(), 6))
                    .orElse(List.of());
            if (!descQuotes.isEmpty()) {
                return new ExcerptResponse(bookId, descQuotes, "description");
            }
        }
        return new ExcerptResponse(bookId, List.of(), "none");
    }

    public ExcerptResponse extractForPublic(UUID bookId) {
        var publicBook = display.findPublic(bookId);
        if (!publicBook.available()) {
            throw ApiException.notFound("BOOK_FILE_NOT_FOUND", "书籍文件暂不可用。");
        }
        BookFile file = books.findPreferredFile(bookId)
                .orElseThrow(() -> ApiException.notFound("BOOK_FILE_NOT_FOUND", "书籍文件不存在。"));
        List<String> bookQuotes = extractFromFile(file);
        if (!bookQuotes.isEmpty()) {
            return new ExcerptResponse(bookId, bookQuotes, "book");
        }
        List<String> descQuotes = extractSentences(publicBook.description(), 6);
        if (!descQuotes.isEmpty()) {
            return new ExcerptResponse(bookId, descQuotes, "description");
        }
        return new ExcerptResponse(bookId, List.of(), "none");
    }

    private List<String> extractAnnotationQuotes(UUID userId, UUID bookId) {
        Set<String> picked = new LinkedHashSet<>();
        for (var ann : annotations.list(userId, bookId)) {
            if (ann.quote() == null) continue;
            String clean = normalizeSentence(ann.quote());
            if (clean.length() >= 10 && clean.length() <= 110) {
                picked.add(clean);
                if (picked.size() >= MAX_QUOTES) break;
            }
        }
        return List.copyOf(picked);
    }

    private List<String> extractFromFile(BookFile file) {
        String key = file.id() + ":" + (file.fingerprint() == null ? "" : file.fingerprint());
        List<String> cached = fileExcerptCache.get(key);
        if (cached != null) return cached;
        try {
            BookTextSampler.Sample sample = text.sample(file);
            List<String> collected = samplePassages(sample.passages());
            fileExcerptCache.put(key, collected);
            return collected;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return List.of();
        } catch (Exception ignored) {
            return List.of();
        }
    }

    static List<String> samplePassages(List<BookTextSampler.Passage> passages) {
        if (passages == null || passages.isEmpty()) return List.of();
        Set<String> all = new LinkedHashSet<>();
        for (var passage : passages) {
            all.addAll(extractSentences(passage.text(), 3));
            if (all.size() >= MAX_QUOTES) break;
        }
        return List.copyOf(all);
    }

    static List<String> extractSentences(String raw, int limit) {
        if (raw == null || raw.isBlank()) return List.of();
        List<String> out = new ArrayList<>();
        String[] parts = SENTENCE_SPLIT.split(raw);
        for (String part : parts) {
            String candidate = normalizeSentence(part);
            if (!isAcceptableSentence(candidate)) continue;
            out.add(candidate);
            if (out.size() >= limit) break;
        }
        return out;
    }

    private static String normalizeSentence(String value) {
        String cleaned = value.replaceAll("[\\t\\r\\n]+", " ")
                .replaceAll("\\s{2,}", " ")
                .replaceAll("^[\\s\\d.、·•—\\-*#\\[\\]()（）]+", "")
                .trim();
        if (cleaned.length() > 86) {
            int cut = lastBreakBefore(cleaned, 84);
            if (cut >= 18) cleaned = cleaned.substring(0, cut + 1);
            else cleaned = cleaned.substring(0, 84) + "……";
        }
        return cleaned;
    }

    private static int lastBreakBefore(String s, int maxIdx) {
        for (int i = Math.min(maxIdx, s.length() - 1); i >= 18; i--) {
            char ch = s.charAt(i);
            if ("。！？；.!?".indexOf(ch) >= 0) return i;
        }
        for (int i = Math.min(maxIdx, s.length() - 1); i >= 24; i--) {
            char ch = s.charAt(i);
            if ("，,;".indexOf(ch) >= 0) return i;
        }
        return -1;
    }

    private static boolean isAcceptableSentence(String s) {
        if (s.length() < 14 || s.length() > 92) return false;
        if (NOISE.matcher(s).find()) return false;
        int letters = 0, digits = 0;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (Character.isDigit(ch)) digits++;
            else if (Character.isLetter(ch) || Character.UnicodeScript.of(ch) == Character.UnicodeScript.HAN) letters++;
        }
        if (letters < 10) return false;
        return digits * 4 <= s.length();
    }

    public record ExcerptResponse(UUID bookId, List<String> quotes, String source) {}
}
