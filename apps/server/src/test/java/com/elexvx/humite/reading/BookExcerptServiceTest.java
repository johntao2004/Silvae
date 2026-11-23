package com.elexvx.humite.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.elexvx.humite.annotations.AnnotationRepository;
import com.elexvx.humite.annotations.AnnotationRepository.Annotation;
import com.elexvx.humite.annotations.AnnotationRepository.AnnotationStyle;
import com.elexvx.humite.annotations.AnnotationRepository.AnnotationType;
import com.elexvx.humite.catalog.BookFile;
import com.elexvx.humite.catalog.BookFileStatus;
import com.elexvx.humite.catalog.BookFormat;
import com.elexvx.humite.catalog.BookRepository;
import com.elexvx.humite.catalog.DisplayCatalogService;
import com.elexvx.humite.filemanagement.infrastructure.BookTextSampler;
import com.elexvx.humite.filemanagement.infrastructure.KnowledgeTextGateway;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class BookExcerptServiceTest {
    @Test
    void prefersUserAnnotationsBeforeSamplingBookFile() throws Exception {
        var books = mock(BookRepository.class);
        var display = mock(DisplayCatalogService.class);
        var annotations = mock(AnnotationRepository.class);
        var gateway = mock(KnowledgeTextGateway.class);
        var service = new BookExcerptService(books, display, annotations, gateway);

        UUID userId = UUID.randomUUID();
        UUID bookId = UUID.randomUUID();
        when(annotations.list(userId, bookId)).thenReturn(List.of(
                new Annotation(UUID.randomUUID(), bookId, "测试书", "作者", AnnotationType.HIGHLIGHT, "cfi",
                        "凡事预则立，不预则废，读书亦然。", "", AnnotationStyle.HIGHLIGHT, "GOLD",
                        OffsetDateTime.now(), null)));

        var response = service.extractForUser(bookId, userId);
        assertThat(response.source()).isEqualTo("annotation");
        assertThat(response.quotes()).containsExactly("凡事预则立，不预则废，读书亦然。");
    }

    @Test
    void samplesCleanSentencesFromBookContentAndFiltersMetadataNoise() throws Exception {
        var books = mock(BookRepository.class);
        var display = mock(DisplayCatalogService.class);
        var annotations = mock(AnnotationRepository.class);
        var gateway = mock(KnowledgeTextGateway.class);
        var service = new BookExcerptService(books, display, annotations, gateway);

        UUID userId = UUID.randomUUID();
        UUID bookId = UUID.randomUUID();
        var file = new BookFile(UUID.randomUUID(), bookId, UUID.randomUUID(), "book.epub",
                BookFormat.EPUB, BookFileStatus.AVAILABLE, 1024, OffsetDateTime.now(), "fp-1", false, false, false);
        when(annotations.list(userId, bookId)).thenReturn(List.of());
        when(books.findPreferredFile(bookId)).thenReturn(Optional.of(file));
        when(gateway.sample(file)).thenReturn(new BookTextSampler.Sample(List.of(
                new BookTextSampler.Passage("ch1",
                        "ISBN 978-7-101-00000-0 Copyright All rights reserved.\n"
                                + "春风吹拂林梢，案头书卷正散发着淡淡墨香。\n"
                                + "目录\n"
                                + "一个人若能静下心来读半卷好书，便觉岁月温柔了许多。")), 2));

        var response = service.extractForUser(bookId, userId);
        assertThat(response.source()).isEqualTo("book");
        assertThat(response.quotes()).containsExactly(
                "春风吹拂林梢，案头书卷正散发着淡淡墨香。",
                "一个人若能静下心来读半卷好书，便觉岁月温柔了许多。");
    }

    @Test
    void restoresInterruptFlagWhenSamplingBookContentIsInterrupted() throws Exception {
        var books = mock(BookRepository.class);
        var display = mock(DisplayCatalogService.class);
        var annotations = mock(AnnotationRepository.class);
        var gateway = mock(KnowledgeTextGateway.class);
        var service = new BookExcerptService(books, display, annotations, gateway);

        UUID userId = UUID.randomUUID();
        UUID bookId = UUID.randomUUID();
        var file = new BookFile(UUID.randomUUID(), bookId, UUID.randomUUID(), "book.epub",
                BookFormat.EPUB, BookFileStatus.AVAILABLE, 1024, OffsetDateTime.now(), "fp-int", false, false, false);
        when(annotations.list(userId, bookId)).thenReturn(List.of());
        when(books.findPreferredFile(bookId)).thenReturn(Optional.of(file));
        when(gateway.sample(file)).thenThrow(new InterruptedException("stopped"));

        try {
            var response = service.extractForUser(bookId, userId);
            assertThat(response.source()).isEqualTo("none");
            assertThat(response.quotes()).isEmpty();
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
    }
}
