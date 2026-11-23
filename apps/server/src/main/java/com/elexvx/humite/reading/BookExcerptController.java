package com.elexvx.humite.reading;

import com.elexvx.humite.users.UserRepository;
import java.security.Principal;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("api")
@RequestMapping("/api/v1")
public class BookExcerptController {
    private final BookExcerptService excerpts;
    private final UserRepository users;

    public BookExcerptController(BookExcerptService excerpts, UserRepository users) {
        this.excerpts = excerpts;
        this.users = users;
    }

    @GetMapping("/books/{bookId}/excerpt")
    BookExcerptService.ExcerptResponse bookExcerpt(@PathVariable UUID bookId, Principal principal) {
        UUID userId = users.findByUsername(principal.getName()).orElseThrow().id();
        return excerpts.extractForUser(bookId, userId);
    }

    @GetMapping("/display-books/{bookId}/excerpt")
    BookExcerptService.ExcerptResponse publicExcerpt(@PathVariable UUID bookId) {
        return excerpts.extractForPublic(bookId);
    }
}
