package com.elexvx.humite.auth;
import java.util.Set;
import java.util.regex.Pattern;
/** Every API family is classified here. Empty is limited to identity/bootstrap and shared public assets. */
public final class ApiPermissionPolicy {
    private static final Pattern USER_ROLE = Pattern.compile("/users/[^/]+/role");
    private static final Pattern USER_SESSIONS_REVOKE = Pattern.compile("/users/[^/]+/sessions/revoke");
    private static final Pattern KNOWLEDGE_BOOK = Pattern.compile("/knowledge/books/[^/]+");
    private static final Pattern VAULT_CHUNK = Pattern.compile("/vault/objects/[^/]+/chunks/[0-9]+");
    private static final Pattern VAULT_OBJECT = Pattern.compile("/vault/objects/[^/]+");
    private static final Pattern VAULT_OBJECT_STATE = Pattern.compile("/vault/objects/[^/]+/state");
    private static final Pattern BOOK_DOWNLOAD = Pattern.compile("/books/[^/]+/download");
    private static final Pattern ARTICLE_COLLECTION_DETAIL = Pattern.compile("/article-collections/[^/]+(?:/.*)?");
    private static final Pattern ARTICLE_READING = Pattern.compile("/articles/[^/]+/reading");
    private static final Pattern ARTICLE_KNOWLEDGE = Pattern.compile("/articles/[^/]+/knowledge");
    private static final Pattern ARTICLE_DETAIL = Pattern.compile("/articles/[^/]+(?:/.*)?");
    private static final Pattern BOOKLIST_DETAIL = Pattern.compile("/booklists/[^/]+(?:/.*)?");
    private static final Pattern CATEGORY_BOOKS = Pattern.compile("/categories/[^/]+/books");
    private static final Pattern BOOK_CATEGORIES = Pattern.compile("/books/[^/]+/categories");
    private static final Pattern ANNOTATIONS_BOOK_EXPORT = Pattern.compile("/annotations/books/[^/]+/export/[^/]+");
    private static final Pattern READER_BOOK_ACTION = Pattern.compile("/(books|display-books)/[^/]+/(content|position|reading-time|excerpt)");
    private static final Pattern DISPLAY_BOOK_META = Pattern.compile("/display-books/[^/]+/(metadata|bibliography-source)");
    private static final Pattern BOOK_META = Pattern.compile("/books/[^/]+/(metadata|bibliography-source)");
    private static final Pattern BOOK_ITEM = Pattern.compile("/books/[^/]+");
    private static final Pattern DISPLAY_BOOK_ITEM = Pattern.compile("/display-books/[^/]+");

    private ApiPermissionPolicy() {}
    public static Set<String> required(String method, String uri) {
        return required(method, uri, "");
    }
    public static Set<String> required(String method, String uri, String queryString) {
        String p = uri.substring("/api/v1".length());
        boolean read = method.equals("GET") || method.equals("HEAD");
        queryString = queryString == null ? "" : queryString;
        boolean hasBookId = hasValidBookId(queryString);
        if (p.startsWith("/auth/two-factor/")) return Set.of("vault.use");
        if (p.startsWith("/auth/")) return Set.of();
        if (p.equals("/site-settings") || p.equals("/site-settings/robots.txt")) return read ? Set.of() : Set.of("settings.site.edit");
        if (p.startsWith("/role-permissions") || USER_ROLE.matcher(p).matches()) return Set.of("roles.manage");
        if (p.equals("/metadata-providers")) return Set.of("settings.metadata." + (read ? "view" : "edit"));
        if (p.startsWith("/users/login-logs")) return Set.of("settings.logs.view");
        if (p.startsWith("/users/active-sessions")) return Set.of("settings.sessions.view");
        if (USER_SESSIONS_REVOKE.matcher(p).matches()) return Set.of("settings.sessions.revoke", "settings.users.manage");
        if (p.equals("/users/security-settings") || p.equals("/users/session-policy") || p.equals("/users/password-policy") || p.equals("/users/vault-policy"))
            return Set.of("settings.security." + (read ? "view" : "edit"));
        if (p.equals("/users") || p.startsWith("/users/")) return Set.of("settings.users." + (read ? "view" : p.equals("/users") ? "create" : "manage"));
        if (p.startsWith("/mail/")) return Set.of("settings.mail." + (read ? "view" : "edit"));
        // The endpoint has source-specific authorization in its service; this route gate admits each valid source grant.
        if (p.equals("/metadata-terms") || p.equals("/metadata-terms/ensure")) return Set.of("library.edit", "library.upload");
        if (p.equals("/ai/metadata-terms")) return Set.of("reader.read", "library.edit", "library.upload");
        if (p.equals("/ai/book-classification")) return Set.of("reader.read", "library.edit", "library.upload");
        if (p.equals("/ai/book-knowledge")) return Set.of("reader.read", "library.edit", "library.upload");
        if (p.equals("/ai/status")) return Set.of(); // Authenticated users may learn whether AI actions are configured; no settings are exposed.
        if (read && KNOWLEDGE_BOOK.matcher(p).matches()) return Set.of("knowledge.view", "reader.read");
        // The assistance service additionally requires the exact source/action grant and object access.
        if (p.equals("/ai/assistance")) return Set.of("reader.read", "articles.view", "notes.edit", "articles.edit", "library.edit", "library.upload");
        if (p.startsWith("/ai/")) return Set.of("settings.ai." + (read ? "view" : "edit"));
        if (VAULT_CHUNK.matcher(p).matches() && method.equals("PUT")) return Set.of("vault.upload");
        if (VAULT_CHUNK.matcher(p).matches() && read) return Set.of("vault.read");
        if (p.equals("/vault/objects") && read) return Set.of("vault.read");
        if (VAULT_OBJECT.matcher(p).matches() && read) return Set.of("vault.read");
        if (VAULT_OBJECT.matcher(p).matches() && method.equals("POST")) return Set.of("vault.upload");
        if (VAULT_OBJECT.matcher(p).matches() && method.equals("DELETE")) return Set.of("vault.delete");
        if (VAULT_OBJECT_STATE.matcher(p).matches() && !read) return Set.of("vault.read");
        if (p.startsWith("/vault/")) return Set.of("vault.use");
        if (p.equals("/library-roots/content-storage")) return Set.of("settings.roots.view");
        if (p.startsWith("/library-roots")) return !read ? Set.of("settings.roots.edit") : Set.of("settings.roots.view", "library.upload", "library.files");
        if (p.startsWith("/book-uploads")) return Set.of(read ? "library.view" : "library.upload");
        if (p.startsWith("/recycle-bin")) return Set.of("settings.recycle." + (read ? "view" : method.equals("DELETE") ? "purge" : "restore"));
        // Actual preview/execute action is checked against the server-side preview type by FileOperationService.
        if (p.equals("/file-task-history")) return Set.of("settings.operations.view");
        if (p.startsWith("/file-operations")) return Set.of("library.files", "library.trash", "settings.recycle.restore", "settings.recycle.purge");
        if (BOOK_DOWNLOAD.matcher(p).matches()) return Set.of("library.download");
        if (p.startsWith("/knowledge")) return Set.of(read ? "knowledge.view" : "knowledge.generate");
        if (p.startsWith("/article-collections")) return Set.of(read
            ? (ARTICLE_COLLECTION_DETAIL.matcher(p).matches() ? "articles.collections.details.view" : "articles.collections.view")
            : "articles.collections.edit");
        if (p.equals("/articles/notes")) return Set.of("notes.articles.view");
        if (p.equals("/articles/knowledge")) return Set.of("articles.view");
        if (p.startsWith("/articles")) {
            if (ARTICLE_READING.matcher(p).matches()) return Set.of("articles.read");
            if (!read && ARTICLE_KNOWLEDGE.matcher(p).matches()) return Set.of("articles.view");
            return Set.of(read ? (ARTICLE_DETAIL.matcher(p).matches() ? "articles.read" : "articles.view") : "articles.edit");
        }
        if (p.startsWith("/booklists")) return Set.of(read
            ? (BOOKLIST_DETAIL.matcher(p).matches() ? "booklists.details.view" : "booklists.view")
            : "booklists.edit");
        if (p.equals("/categories") || CATEGORY_BOOKS.matcher(p).matches()) return Set.of(read ? "library.query" : "library.organize");
        if (p.startsWith("/categories") || BOOK_CATEGORIES.matcher(p).matches()) return Set.of(read ? "library.view" : "library.organize");
        if (p.equals("/annotations/books") || ANNOTATIONS_BOOK_EXPORT.matcher(p).matches()) return Set.of("notes.books.view");
        if (p.startsWith("/annotations")) return read
            ? Set.of(hasBookId ? "reader.read" : "notes.view") : Set.of("reader.annotate");
        if (p.startsWith("/reading-posts")) return Set.of(read ? "notes.posts.view" : "notes.edit");
        if (p.equals("/reading-overview")) return Set.of("library.overview");
        if (p.startsWith("/reader-fonts")) return read ? Set.of("reader.read", "settings.fonts.view") : Set.of("settings.fonts.edit");
        if (READER_BOOK_ACTION.matcher(p).matches()) return Set.of("reader.read");
        if (p.equals("/books") && read) return Set.of("library.query");
        if (p.equals("/books/revision")) return Set.of(read ? "library.query" : "library.edit");
        if (p.equals("/display-books") && read) return Set.of("library.query"); // Anonymous discovery bypasses role grants in RolePermissionFilter.
        if (DISPLAY_BOOK_META.matcher(p).matches()) return Set.of(read ? "library.details.view" : "library.edit");
        if (BOOK_META.matcher(p).matches()) return Set.of(read ? "library.details.view" : "library.edit");
        if (BOOK_ITEM.matcher(p).matches() || DISPLAY_BOOK_ITEM.matcher(p).matches()) return Set.of(read ? "library.details.view" : "library.edit");
        if (p.startsWith("/display-books")) return Set.of(read ? "library.view" : "library.edit");
        if (p.startsWith("/books")) return Set.of(read ? "library.view" : "library.edit");
        return Set.of("roles.manage"); // Unknown future APIs are closed to delegated roles until explicitly classified.
    }

    private static boolean hasValidBookId(String queryString) {
        String value = null;
        for (String pair : queryString.split("&")) {
            String[] parts = pair.split("=", 2);
            if (!parts[0].equals("bookId")) continue;
            if (value != null) return false;
            try {
                value = java.net.URLDecoder.decode(parts.length == 2 ? parts[1] : "", java.nio.charset.StandardCharsets.UTF_8);
                java.util.UUID.fromString(value);
            } catch (IllegalArgumentException invalid) {
                return false;
            }
        }
        return value != null;
    }
}
