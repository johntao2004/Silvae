package com.elexvx.humite.catalog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.elexvx.humite.users.UserRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpHeaders;

class BookControllerTest {
    @TempDir
    Path rootDir;

    @Test
    void privateBookCoverUsesCachePrivateInsteadOfCachePublic() throws Exception {
        UUID bookId = UUID.randomUUID();
        Path cover = rootDir.resolve("cover.jpg");
        Files.write(cover, new byte[]{1, 2, 3});
        BookRepository books = mock(BookRepository.class);
        when(books.findCover(bookId)).thenReturn(Optional.of(
                new BookRepository.CoverLocation("cover.jpg", rootDir.toString(), rootDir.toRealPath().toString())));

        var response = new BookController(books, mock(UserRepository.class)).cover(bookId);

        assertEquals(200, response.getStatusCode().value());
        String cacheControl = response.getHeaders().getFirst(HttpHeaders.CACHE_CONTROL);
        assertNotNull(cacheControl);
        assertTrue(cacheControl.contains("private"));
        assertFalse(cacheControl.contains("public"));
    }
}
