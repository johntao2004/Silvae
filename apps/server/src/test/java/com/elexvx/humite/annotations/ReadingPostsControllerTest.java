package com.elexvx.humite.annotations;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.elexvx.humite.articles.ArticleController;
import com.elexvx.humite.articles.ArticleNotesController;
import com.elexvx.humite.articles.ArticleNotesService;
import com.elexvx.humite.articles.ArticleService;
import com.elexvx.humite.auth.MustChangePasswordFilter;
import com.elexvx.humite.auth.PermissionTestFixtures;
import com.elexvx.humite.auth.RolePermissionService;
import com.elexvx.humite.auth.SecurityConfig;
import com.elexvx.humite.auth.SessionLifecycleService;
import com.elexvx.humite.auth.SessionLifetimeFilter;
import com.elexvx.humite.catalog.BookRepository;
import com.elexvx.humite.catalog.BookReviewRepository;
import com.elexvx.humite.catalog.BookReviewRepository.BookReview;
import com.elexvx.humite.catalog.BookReviewService;
import com.elexvx.humite.catalog.ReviewVisibility;
import com.elexvx.humite.common.ApiExceptionHandler;
import com.elexvx.humite.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitWebConfig(ReadingPostsControllerTest.Config.class)
@ActiveProfiles("api")
class ReadingPostsControllerTest {
    @Configuration
    @EnableWebSecurity
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiExceptionHandler.class, ArticleController.class,
        ArticleNotesController.class, ReadingPostsController.class})
    static class Config {
        @Bean SessionLifecycleService sessionLifecycle() {
            var service = mock(SessionLifecycleService.class);
            when(service.status(any())).thenReturn(new SessionLifecycleService.Status(
                    Long.MAX_VALUE, false, System.currentTimeMillis()));
            return service;
        }

        @Bean SessionLifetimeFilter sessionLifetimeFilter(SessionLifecycleService service) {
            return new SessionLifetimeFilter(service);
        }

        @Bean UserRepository users() { return PermissionTestFixtures.users(); }

        @Bean RolePermissionService permissions() { return PermissionTestFixtures.permissions(); }

        @Bean MustChangePasswordFilter passwordFilter(UserRepository users) {
            return new MustChangePasswordFilter(users);
        }

        @Bean ArticleNotesService articleNotes() { return mock(ArticleNotesService.class); }

        @Bean ArticleService articles() { return mock(ArticleService.class); }

        @Bean ArticlePostRepository articlePosts() { return mock(ArticlePostRepository.class); }

        @Bean BookReviewRepository bookReviewRepository() { return mock(BookReviewRepository.class); }

        @Bean BookRepository catalog() { return mock(BookRepository.class); }

        @Bean BookReviewService bookReviewService(BookReviewRepository reviews, BookRepository catalog,
                                                  UserRepository users) {
            return new BookReviewService(reviews, catalog, users);
        }

        @Bean ReadingPostsService readingPosts(ArticlePostRepository articlePosts, BookReviewService bookReviewService,
                                               BookRepository catalog, ArticleService articles, UserRepository users) {
            return new ReadingPostsService(articlePosts, bookReviewService, catalog, articles, users);
        }
    }

    @Autowired WebApplicationContext context;
    @Autowired ArticleNotesService articleNotes;
    @Autowired ArticlePostRepository articlePosts;
    @Autowired BookReviewRepository bookReviewRepository;
    @Autowired BookRepository catalog;
    MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        clearInvocations(articleNotes, articlePosts, bookReviewRepository, catalog);
        when(articleNotes.notes(any())).thenReturn(List.of());
        when(articlePosts.mine(any(), any(), any(), eq(31))).thenReturn(List.of());
        when(bookReviewRepository.findMine(any(), any(), any(), eq(31))).thenReturn(List.of());
    }

    @Test
    void anonymousCannotReadNotesOrPostsAndLegacyReviewRoutesAreGone() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(get("/api/v1/articles/notes")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/reading-posts")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/reading-posts?kind=BOOK&sourceId={id}", id)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/reading-posts/BOOK/{id}", id)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/reading-posts/ARTICLE/{id}", id)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/reading-posts").with(csrf()).contentType("application/json")
                        .content("{\"kind\":\"BOOK\",\"sourceId\":\"" + id + "\",\"title\":\"标题\",\"markdown\":\"正文\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(put("/api/v1/reading-posts/BOOK/{id}", id).with(csrf()).contentType("application/json")
                        .content("{\"title\":\"标题\",\"markdown\":\"正文\",\"revision\":1}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(articleNotes, articlePosts, bookReviewRepository);

        mvc.perform(get("/api/v1/books/{bookId}/reviews", id).with(user("owner").roles("OWNER")))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/books/{bookId}/reviews", id).with(user("owner").roles("OWNER")).with(csrf())
                        .contentType("application/json").content("{\"title\":\"标题\",\"markdown\":\"正文\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/v1/book-reviews/{id}", id).with(user("owner").roles("OWNER")).with(csrf())
                        .contentType("application/json").content("{\"title\":\"标题\",\"markdown\":\"正文\",\"revision\":1}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void readingPostsAndArticleNotesRequireAuthenticationCsrfAndNoStoreResponses() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(get("/api/v1/articles/notes").with(user("reader").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")));
        mvc.perform(get("/api/v1/reading-posts?kind=ALL").with(user("reader").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")));
        mvc.perform(post("/api/v1/reading-posts").with(user("reader").roles("MEMBER"))
                        .contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/reading-posts/ARTICLE/{id}", id).with(user("reader").roles("MEMBER")).with(csrf())
                        .contentType("application/json").content("{\"title\":\"标题\",\"markdown\":\"正文\",\"revision\":0}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void listingBySourceIdFiltersBookReviewsWithVisibilityAndResolvedTitle() throws Exception {
        UUID bookId = UUID.randomUUID();
        UUID aliceId = fixtureUserId("alice");
        UUID bobId = fixtureUserId("bob");
        var now = OffsetDateTime.now();
        var alicePrivate = new BookReview(UUID.randomUUID(), bookId, aliceId, "alice", "私人随笔",
                "## 私人内容", ReviewVisibility.PRIVATE, 1, now, now);
        var aliceShared = new BookReview(UUID.randomUUID(), bookId, aliceId, "alice", "公开随笔",
                "## 共享内容", ReviewVisibility.LIBRARY, 2, now.minusMinutes(1), now);
        when(catalog.exists(bookId)).thenReturn(true);
        when(catalog.reference(bookId)).thenReturn(Optional.of(new BookRepository.BookReference(bookId, "测试书籍")));
        when(bookReviewRepository.findVisible(bookId, aliceId)).thenReturn(List.of(alicePrivate, aliceShared));
        when(bookReviewRepository.findVisible(bookId, bobId)).thenReturn(List.of(aliceShared));

        mvc.perform(get("/api/v1/reading-posts?kind=BOOK&sourceId={bookId}", bookId)
                        .with(user("alice").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].kind").value("BOOK"))
                .andExpect(jsonPath("$.items[0].sourceId").value(bookId.toString()))
                .andExpect(jsonPath("$.items[0].sourceTitle").value("测试书籍"))
                .andExpect(jsonPath("$.items[0].markdown").value("## 私人内容"))
                .andExpect(jsonPath("$.items[0].visibility").value("PRIVATE"));

        mvc.perform(get("/api/v1/reading-posts?kind=BOOK&sourceId={bookId}", bookId)
                        .with(user("bob").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].title").value("公开随笔"))
                .andExpect(jsonPath("$.items[0].markdown").value("## 共享内容"));

        UUID missingBookId = UUID.randomUUID();
        when(catalog.exists(missingBookId)).thenReturn(false);
        mvc.perform(get("/api/v1/reading-posts?kind=BOOK&sourceId={bookId}", missingBookId)
                        .with(user("alice").roles("MEMBER")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOOK_NOT_FOUND"));
    }

    @Test
    void listingBySourceIdRejectsUnsupportedKinds() throws Exception {
        UUID bookId = UUID.randomUUID();
        mvc.perform(get("/api/v1/reading-posts?sourceId={bookId}", bookId).with(user("alice").roles("MEMBER")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_POST_FILTER"));
        mvc.perform(get("/api/v1/reading-posts?kind=ARTICLE&sourceId={bookId}", bookId)
                        .with(user("alice").roles("MEMBER")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_POST_FILTER"));
        verifyNoInteractions(bookReviewRepository);
    }

    @Test
    void loggedInMemberCanCreateBookPostAndDefaultsToPrivate() throws Exception {
        UUID bookId = UUID.randomUUID();
        UUID reviewId = UUID.randomUUID();
        UUID aliceId = fixtureUserId("alice");
        var now = OffsetDateTime.now();
        when(catalog.exists(bookId)).thenReturn(true);
        when(catalog.reference(bookId)).thenReturn(Optional.of(new BookRepository.BookReference(bookId, "书名")));
        when(bookReviewRepository.create(any(), eq(bookId), eq(aliceId), eq("alice"),
                eq("标题"), eq("正文"), eq(ReviewVisibility.PRIVATE)))
                .thenReturn(new BookReview(reviewId, bookId, aliceId, "alice", "标题", "正文",
                        ReviewVisibility.PRIVATE, 1, now, now));

        mvc.perform(post("/api/v1/reading-posts").with(user("alice").roles("MEMBER")).with(csrf())
                        .contentType("application/json")
                        .content("{\"kind\":\"BOOK\",\"sourceId\":\"" + bookId + "\",\"title\":\" 标题 \",\"markdown\":\"正文\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.id").value(reviewId.toString()))
                .andExpect(jsonPath("$.kind").value("BOOK"))
                .andExpect(jsonPath("$.sourceId").value(bookId.toString()))
                .andExpect(jsonPath("$.sourceTitle").value("书名"))
                .andExpect(jsonPath("$.markdown").value("正文"))
                .andExpect(jsonPath("$.visibility").value("PRIVATE"))
                .andExpect(jsonPath("$.revision").value(1));

        verify(bookReviewRepository).create(any(), eq(bookId), eq(aliceId), eq("alice"),
                eq("标题"), eq("正文"), eq(ReviewVisibility.PRIVATE));
    }

    @Test
    void updatingBookPostHandlesSuccessConflictAndOwnership() throws Exception {
        UUID bookId = UUID.randomUUID();
        UUID reviewId = UUID.randomUUID();
        UUID aliceId = fixtureUserId("alice");
        UUID bobId = fixtureUserId("bob");
        var now = OffsetDateTime.now();
        when(catalog.reference(bookId)).thenReturn(Optional.of(new BookRepository.BookReference(bookId, "书名")));
        when(bookReviewRepository.update(reviewId, aliceId, 1L, "新标题", "新正文", ReviewVisibility.LIBRARY))
                .thenReturn(Optional.of(new BookReview(reviewId, bookId, aliceId, "alice", "新标题", "新正文",
                        ReviewVisibility.LIBRARY, 2, now, now)));
        when(bookReviewRepository.update(reviewId, aliceId, 1L, "过期标题", "旧正文", ReviewVisibility.PRIVATE))
                .thenReturn(Optional.empty());
        when(bookReviewRepository.ownedBy(reviewId, aliceId)).thenReturn(true);
        when(bookReviewRepository.update(eq(reviewId), eq(bobId), eq(1L), anyString(), anyString(), any()))
                .thenReturn(Optional.empty());
        when(bookReviewRepository.ownedBy(reviewId, bobId)).thenReturn(false);

        mvc.perform(put("/api/v1/reading-posts/BOOK/{id}", reviewId).with(user("alice").roles("MEMBER")).with(csrf())
                        .contentType("application/json")
                        .content("{\"title\":\"新标题\",\"markdown\":\"新正文\",\"visibility\":\"LIBRARY\",\"revision\":1}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.revision").value(2))
                .andExpect(jsonPath("$.sourceTitle").value("书名"))
                .andExpect(jsonPath("$.visibility").value("LIBRARY"));

        mvc.perform(put("/api/v1/reading-posts/BOOK/{id}", reviewId).with(user("alice").roles("MEMBER")).with(csrf())
                        .contentType("application/json")
                        .content("{\"title\":\"过期标题\",\"markdown\":\"旧正文\",\"revision\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REVISION_CONFLICT"));

        mvc.perform(put("/api/v1/reading-posts/BOOK/{id}", reviewId).with(user("bob").roles("MEMBER")).with(csrf())
                        .contentType("application/json")
                        .content("{\"title\":\"越权\",\"markdown\":\"恶意\",\"revision\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOOK_REVIEW_NOT_FOUND"));
    }

    private static UUID fixtureUserId(String username) {
        return UUID.nameUUIDFromBytes(username.getBytes(StandardCharsets.UTF_8));
    }
}
