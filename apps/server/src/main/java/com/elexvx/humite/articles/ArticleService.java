package com.elexvx.humite.articles;

import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.auth.RolePermissionService;
import com.elexvx.humite.users.*;
import com.elexvx.humite.filemanagement.infrastructure.PrivateContentStore;
import com.elexvx.humite.ai.AiMetadataService;
import tools.jackson.databind.ObjectMapper;
import java.security.Principal;
import jakarta.validation.constraints.*;
import java.util.*;
import java.io.*;
import javax.imageio.ImageIO;
import org.jooq.DSLContext;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Safelist;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
// 协调需登录的文章读取、受控导入、图片清洗及用户阅读记录；正文清洗不依赖前端可信。
// Coordinates authenticated article reads, controlled imports, image sanitization and user reading state without trusting client sanitization.
public class ArticleService {
    static final int MAX_CAPTURE_HTML_BYTES = 8 * 1024 * 1024;
    private static final java.util.regex.Pattern INTERNAL_ASSET_URL=java.util.regex.Pattern.compile("^/api/v1/articles/assets/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$");
    private static final java.util.regex.Pattern SAFE_CSS_RULE=java.util.regex.Pattern.compile("(?i)(text-align\\s*:\\s*(left|right|center|justify)|font-weight\\s*:\\s*(bold|normal|[1-9]00)|font-style\\s*:\\s*(italic|normal)|text-decoration\\s*:\\s*(underline|line-through)|white-space\\s*:\\s*(pre-wrap|normal))");
    private static final java.util.regex.Pattern SAFE_DATA_IMAGE_MIME=java.util.regex.Pattern.compile("(?i)image/(?:jpeg|png|webp)");
    private static final Set<String> PARAGRAPH_ID_TAGS=Set.of("p","h1","h2","h3","h4","li","blockquote","pre","figure");
    private static final Safelist SAFE_HTML=Safelist.relaxed().addTags("section","figure","figcaption","mark").addAttributes(":all","style","id").preserveRelativeLinks(true);
    private static final int MAX_COVER_BYTES = 5 * 1024 * 1024;
    static final int MAX_BATCH_IMPORT_URLS = 20;
    private static final long FETCH_WINDOW_MS = 60_000L;
    private static final int FETCH_MAX_PER_WINDOW = 20;
    private final java.util.concurrent.ConcurrentHashMap<UUID, java.util.Deque<Long>> fetchHistory = new java.util.concurrent.ConcurrentHashMap<>();
    private final ThreadLocal<Boolean> saveInNewTx = new ThreadLocal<>();
    private final DSLContext db; private final UserRepository users; private final PublicWebFetcher web;
    private final PrivateContentStore files; private final ObjectMapper json;
    private final RolePermissionService permissions;
    private org.springframework.transaction.PlatformTransactionManager transactionManager;
    @org.springframework.beans.factory.annotation.Autowired
    public ArticleService(DSLContext db, UserRepository users, PublicWebFetcher web, PrivateContentStore files,
                          AiMetadataService ai, ObjectMapper json, RolePermissionService permissions) {
        this.db=db;this.users=users;this.web=web;this.files=files;this.json=json;this.permissions=permissions;
    }
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setTransactionManager(org.springframework.transaction.PlatformTransactionManager transactionManager) {
        this.transactionManager = transactionManager;
    }
    public ArticleService(DSLContext db, UserRepository users, PublicWebFetcher web, PrivateContentStore files, AiMetadataService ai, ObjectMapper json) {
        this(db,users,web,files,ai,json,null);
    }
    public HumiteUser actor(Principal principal) {
        if(principal==null) throw ApiException.forbidden("AUTH_REQUIRED","请先登录。");
        return users.findByUsername(principal.getName()).orElseThrow(() -> ApiException.forbidden("AUTH_REQUIRED","请先登录。"));
    }
    private HumiteUser manager(Principal principal) {
        var user=actor(principal);if(!user.canManageFiles())throw ApiException.forbidden("MANAGER_REQUIRED","仅站点所有者和管理员可导入或管理文章。");return user;
    }
    public List<Map<String,Object>> list(Principal principal) {
        var user=actor(principal);
        var rows=db.fetch("select a.id,a.title,a.author,a.source_url,a.published_at,a.visibility,a.tags,a.created_at,a.updated_at,a.owner_id,a.html,a.cover_asset_id from articles a where a.visibility='PUBLIC' or a.owner_id=? or ? order by a.created_at desc limit 500",user.id(),user.canManageFiles()).intoMaps();
        var cards=new ArrayList<Map<String,Object>>(rows.size());
        for(var row:rows) {
            var card=new LinkedHashMap<String,Object>(row);
            String html=(String)card.remove("html");
            UUID coverAsset=(UUID)card.remove("cover_asset_id");
            card.put("cover_url",coverAsset==null?null:assetUrl(coverAsset));
            card.put("excerpt",articleExcerpt(html));
            cards.add(card);
        }
        return cards;
    }
    private static String assetUrl(UUID id) { return "/api/v1/articles/assets/"+id; }
    private static String articleExcerpt(String html) {
        if(html==null||html.isBlank())return "";
        var document=Jsoup.parseBodyFragment(html);
        document.select("script,style,iframe,form,object,embed,svg,video,audio,template,noscript").remove();
        String text=document.body().text();
        int codePoints=text.codePointCount(0,text.length());
        return codePoints<=200?text:text.substring(0,text.offsetByCodePoints(0,200));
    }
    public Map<String,Object> get(UUID id,Principal principal) {
        var user=actor(principal);
        var row=db.fetchOne("select * from articles where id=? and (visibility='PUBLIC' or owner_id=? or ?)",id,user.id(),user.canManageFiles());
        if(row==null)throw ApiException.notFound("ARTICLE_NOT_FOUND","文章不存在或无权访问。");
        var article=new LinkedHashMap<String,Object>(row.intoMap());
        article.remove("duplicate_source_key");
        article.remove("duplicate_content_key");
        UUID coverAsset=(UUID)article.remove("cover_asset_id");
        article.put("cover_url",coverAsset==null?null:assetUrl(coverAsset));
        return article;
    }

    /** Module gateway for a readable source label; never loads article HTML or another user's notes. */
    public ArticleReference reference(UUID id, Principal principal) {
        var user = actor(principal);
        var row = db.fetchOne("select id,title from articles where id=? and (visibility='PUBLIC' or owner_id=? or ?)",
                id, user.id(), user.canManageFiles());
        if (row == null) throw ApiException.notFound("ARTICLE_NOT_FOUND", "文章不存在或无权访问。");
        return new ArticleReference(row.get("id", UUID.class), row.get("title", String.class));
    }
    public Map<UUID, String> references(List<UUID> ids, Principal principal) {
        if (ids.isEmpty()) return Map.of();
        var user = actor(principal);
        List<UUID> distinct = ids.stream().distinct().toList();
        return db.fetch("select id,title from articles where id = any(?::uuid[]) and (visibility='PUBLIC' or owner_id=? or ?)",
                        distinct.toArray(UUID[]::new), user.id(), user.canManageFiles()).stream()
                .collect(java.util.stream.Collectors.toMap(
                        row -> row.get("id", UUID.class),
                        row -> row.get("title", String.class)));
    }
    private HumiteUser requireAccessible(UUID id, Principal principal) {
        var user = actor(principal);
        var exists = db.fetchExists(db.selectOne().from("articles").where("id=? and (visibility='PUBLIC' or owner_id=? or ?)",
                id, user.id(), user.canManageFiles()));
        if (!exists) throw ApiException.notFound("ARTICLE_NOT_FOUND", "文章不存在或无权访问。");
        return user;
    }
    public record ArticleReference(UUID id, String title) {}
    public record Draft(@NotBlank @Size(max=300) String title,@NotNull @Size(max=300) String author,@NotNull @Size(max=4096) String sourceUrl,@NotNull @Size(max=100) String publishedAt,@NotNull String visibility,@NotNull @Size(max=1000) String tags,@NotNull @Size(max=30000000) String html,@Size(max=8000000) String coverUrl) {}
    public record BatchImportItem(String url, String status, String id, String title, String message) {}
    public record BatchImportResult(int imported, int duplicate, int failed, List<BatchImportItem> items) {}
    public record PreparedBatch(List<String> urls, String visibility, String tags) {}
    public record StreamEvent(
            String type,
            String stage,
            String message,
            String url,
            String title,
            String author,
            Integer itemIndex,
            Integer itemTotal,
            Integer imageIndex,
            Integer imageTotal,
            Integer percent,
            BatchImportItem item,
            Draft draft,
            BatchImportResult batchResult,
            Integer status,
            String code) {
        static StreamEvent progress(String stage, String message, String url, String title, String author,
                                    int itemIndex, int itemTotal, int imageIndex, int imageTotal, int percent) {
            return new StreamEvent("progress", stage, message, url, title, author,
                    itemIndex, itemTotal, imageIndex, imageTotal, percent, null, null, null, null, null);
        }
        static StreamEvent item(BatchImportItem item, String message, int itemIndex, int itemTotal, int percent) {
            return new StreamEvent("item", "ITEM_DONE", message, item.url(), item.title(), null,
                    itemIndex, itemTotal, 0, 0, percent, item, null, null, null, null);
        }
        static StreamEvent result(Draft draft) {
            return new StreamEvent("result", "DONE", "读取完成，正在打开预览…", draft.sourceUrl(), draft.title(), draft.author(),
                    1, 1, 0, 0, 100, null, draft, null, null, null);
        }
        static StreamEvent batchResult(BatchImportResult batchResult) {
            return new StreamEvent("result", "DONE", "批量导入已完成。", null, null, null,
                    batchResult.items().size(), batchResult.items().size(), 0, 0, 100, null, null, batchResult, null, null);
        }
        static StreamEvent error(int status, String code, String message) {
            return new StreamEvent("error", "ERROR", message, null, null, null,
                    null, null, null, null, null, null, null, null, status, code);
        }
    }
    @FunctionalInterface
    private interface CaptureProgressCallback {
        void emit(String stage, String message, String title, String author, int imageIndex, int imageTotal, int subPercent);
    }
    @FunctionalInterface
    private interface ImageProgressCallback {
        void onImage(int index, int total);
    }
    public String serializeStreamEvent(StreamEvent event) {
        ObjectMapper mapper = json != null ? json : new ObjectMapper();
        return mapper.writeValueAsString(event);
    }
    public String prepare(String html,String sourceUrl,Principal principal) {
        manager(principal);
        return clean(html,sourceUrl,principal);
    }
    public String prepareFetch(String url, Principal principal) {
        var requesting = manager(principal);
        rejectDuplicateSource(url, null);
        enforceFetchRate(requesting, 1);
        return url;
    }
    public Draft fetch(String url,Principal principal) {
        prepareFetch(url, principal);
        return captureDraft(url, principal, null);
    }
    public Draft executeFetch(String url, Principal principal, java.util.function.Consumer<StreamEvent> listener) {
        return captureDraft(url, principal, (stage, message, title, author, imageIndex, imageTotal, subPercent) ->
                emitProgress(listener, stage, message, url, title, author, 1, 1, imageIndex, imageTotal, subPercent));
    }
    public PreparedBatch prepareBatchImport(List<String> urls, String visibility, String tags, Principal principal) {
        var requesting = manager(principal);
        if (!Set.of("PUBLIC", "PRIVATE").contains(visibility)) {
            throw ApiException.badRequest("VISIBILITY", "可见范围无效。");
        }
        if (urls == null || urls.isEmpty() || urls.size() > MAX_BATCH_IMPORT_URLS) {
            throw ApiException.badRequest("BATCH_LIMIT", "单次批量导入链接数需在 1–" + MAX_BATCH_IMPORT_URLS + " 之间。");
        }
        enforceFetchRate(requesting, urls.size());
        String batchTags = clampText(tags == null ? "" : tags.trim(), 1000);
        return new PreparedBatch(urls, visibility, batchTags);
    }
    public BatchImportResult batchImport(List<String> urls, String visibility, String tags, Principal principal) {
        return executeBatchImport(prepareBatchImport(urls, visibility, tags, principal), principal, null);
    }
    public BatchImportResult executeBatchImport(PreparedBatch prepared, Principal principal, java.util.function.Consumer<StreamEvent> listener) {
        List<String> urls = prepared.urls();
        String visibility = prepared.visibility();
        String batchTags = prepared.tags();
        int total = urls.size();
        var items = new ArrayList<BatchImportItem>(total);
        var seenSourceKeys = new HashSet<String>();
        int imported = 0, duplicate = 0, failed = 0;
        for (int index = 0; index < total; index++) {
            int itemIndex = index + 1;
            String rawUrl = urls.get(index);
            String trimmedUrl = rawUrl == null ? "" : rawUrl.trim();
            int startPercent = Math.round((index * 100f) / total);
            int endPercent = Math.round((itemIndex * 100f) / total);
            if (trimmedUrl.isEmpty()) {
                failed++;
                var item = new BatchImportItem("", "FAILED", null, null, "链接不能为空。");
                items.add(item);
                emitItem(listener, item, "第 " + itemIndex + "/" + total + " 篇链接为空，已跳过", itemIndex, total, endPercent);
                continue;
            }
            emitProgress(listener, "FETCHING_PAGE",
                    "正在请求第 " + itemIndex + "/" + total + " 篇：" + trimmedUrl,
                    trimmedUrl, null, null, itemIndex, total, 0, 0, startPercent);
            String requestKey = ArticleIdentity.sourceKey(trimmedUrl);
            if (!requestKey.isEmpty() && !seenSourceKeys.add(requestKey)) {
                duplicate++;
                var item = new BatchImportItem(trimmedUrl, "DUPLICATE", null, null, "本次提交中存在重复链接，已跳过。");
                items.add(item);
                emitItem(listener, item, "第 " + itemIndex + "/" + total + " 篇链接重复，已跳过", itemIndex, total, endPercent);
                continue;
            }
            try {
                rejectDuplicateSource(trimmedUrl, null);
                Draft captured = captureDraft(trimmedUrl, principal, (stage, message, title, author, imageIndex, imageTotal, subPercent) -> {
                    int mappedPercent = Math.min(99, Math.round(startPercent + (subPercent / 100f) * (100f / total)));
                    String prefix = "第 " + itemIndex + "/" + total + " 篇";
                    String scopedMessage = (title != null && !title.isBlank())
                            ? prefix + "《" + clampText(title, 36) + "》" + message
                            : prefix + "：" + message;
                    emitProgress(listener, stage, scopedMessage, trimmedUrl, title, author,
                            itemIndex, total, imageIndex, imageTotal, mappedPercent);
                });
                String finalKey = ArticleIdentity.sourceKey(captured.sourceUrl());
                if (!finalKey.isEmpty() && !finalKey.equals(requestKey) && !seenSourceKeys.add(finalKey)) {
                    duplicate++;
                    var item = new BatchImportItem(trimmedUrl, "DUPLICATE", null, null, "本次提交中存在重复来源链接，已跳过。");
                    items.add(item);
                    emitItem(listener, item, "第 " + itemIndex + "/" + total + " 篇来源重复，已跳过", itemIndex, total, endPercent);
                    continue;
                }
                String title = captured.title() == null || captured.title().isBlank()
                        ? fallbackTitle(captured.sourceUrl(), trimmedUrl)
                        : clampText(captured.title().trim(), 300);
                emitProgress(listener, "SAVING",
                        "正在保存第 " + itemIndex + "/" + total + " 篇《" + clampText(title, 36) + "》…",
                        trimmedUrl, title, captured.author(), itemIndex, total, 0, 0, Math.max(startPercent, endPercent - 1));
                Draft draft = new Draft(
                        title,
                        clampText(captured.author(), 300),
                        clampText(captured.sourceUrl(), 4096),
                        clampText(captured.publishedAt(), 100),
                        visibility,
                        batchTags,
                        captured.html(),
                        captured.coverUrl());
                Map<String, Object> saved = saveInNewTransaction(draft, principal);
                imported++;
                var item = new BatchImportItem(
                        trimmedUrl,
                        "IMPORTED",
                        String.valueOf(saved.get("id")),
                        String.valueOf(saved.get("title")),
                        null);
                items.add(item);
                emitItem(listener, item, "已完成第 " + itemIndex + "/" + total + " 篇：《" + item.title() + "》", itemIndex, total, endPercent);
            } catch (ApiException error) {
                if ("ARTICLE_DUPLICATE".equals(error.code())) {
                    duplicate++;
                    var item = new BatchImportItem(trimmedUrl, "DUPLICATE", null, null, error.getMessage());
                    items.add(item);
                    emitItem(listener, item, "第 " + itemIndex + "/" + total + " 篇已存在，已跳过", itemIndex, total, endPercent);
                } else {
                    failed++;
                    var item = new BatchImportItem(trimmedUrl, "FAILED", null, null, error.getMessage());
                    items.add(item);
                    emitItem(listener, item, "第 " + itemIndex + "/" + total + " 篇失败：" + error.getMessage(), itemIndex, total, endPercent);
                }
            } catch (Exception error) {
                failed++;
                var item = new BatchImportItem(trimmedUrl, "FAILED", null, null, "抓取或导入失败，请稍后重试或手动导入。");
                items.add(item);
                emitItem(listener, item, "第 " + itemIndex + "/" + total + " 篇抓取或导入失败", itemIndex, total, endPercent);
            }
        }
        return new BatchImportResult(imported, duplicate, failed, items);
    }
    private static void emitProgress(java.util.function.Consumer<StreamEvent> listener, String stage, String message,
                                     String url, String title, String author,
                                     int itemIndex, int itemTotal, int imageIndex, int imageTotal, int percent) {
        if (listener == null) return;
        listener.accept(StreamEvent.progress(stage, message, url, title, author, itemIndex, itemTotal, imageIndex, imageTotal, percent));
    }
    private static void emitItem(java.util.function.Consumer<StreamEvent> listener, BatchImportItem item,
                                 String message, int itemIndex, int itemTotal, int percent) {
        if (listener == null) return;
        listener.accept(StreamEvent.item(item, message, itemIndex, itemTotal, percent));
    }
    private void enforceFetchRate(HumiteUser requesting, int permits) {
        long now = System.currentTimeMillis();
        fetchHistory.compute(requesting.id(), (id, previous) -> {
            java.util.Deque<Long> entries = previous != null ? previous : new java.util.ArrayDeque<>();
            while (!entries.isEmpty() && now - entries.peekFirst() >= FETCH_WINDOW_MS) {
                entries.pollFirst();
            }
            if (entries.size() + permits > FETCH_MAX_PER_WINDOW) {
                throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "FETCH_RATE", "抓取请求过于频繁，请稍等片刻再试。");
            }
            for (int i = 0; i < permits; i++) {
                entries.addLast(now);
            }
            return entries;
        });
    }
    private Draft captureDraft(String url, Principal principal, CaptureProgressCallback progress) {
        if (progress != null) {
            progress.emit("FETCHING_PAGE", "正在请求网页：" + url, null, null, 0, 0, 10);
        }
        var result=web.get(url,MAX_CAPTURE_HTML_BYTES);
        rejectDuplicateSource(result.url(),null);
        if(result.mime()==null || !result.mime().toLowerCase(Locale.ROOT).contains("html"))throw ApiException.badRequest("NOT_HTML","链接不是 HTML 网页。");
        if (progress != null) {
            progress.emit("PARSING", "已读取网页（" + formatByteSize(result.bytes().length) + "），正在解析标题与正文…", null, null, 0, 0, 30);
        }
        var document=Jsoup.parse(new String(result.bytes(),java.nio.charset.StandardCharsets.UTF_8),result.url());
        Element body=document.selectFirst("#js_content,article,main");if(body==null)body=document.body();
        var title=document.selectFirst("#activity-name,h1");var author=document.selectFirst("#js_name,[rel=author]");
        String extractedTitle = title==null?document.title():title.text();
        String extractedAuthor = author==null?"":author.text();
        String publishedAt=ArticlePublicationTime.extract(document,json);
        if (progress != null) {
            progress.emit("CAPTURING_COVER", "已读取标题《" + clampText(extractedTitle, 40) + "》，正在检查封面图…", extractedTitle, extractedAuthor, 0, 0, 40);
        }
        String coverUrl=captureCover(document,body,result.url(),principal);
        String cleanedBody = clean(body.html(), result.url(), principal, (imageIndex, imageTotal) -> {
            if (progress == null) return;
            int subPercent = imageTotal > 0 ? 45 + Math.round(((imageIndex - 1) * 50f) / imageTotal) : 90;
            progress.emit("CAPTURING_IMAGES",
                    imageTotal > 0 ? "正在读取正文图片（" + imageIndex + "/" + imageTotal + "）…" : "正在清洗正文内容…",
                    extractedTitle, extractedAuthor, imageIndex, imageTotal, subPercent);
        });
        return new Draft(extractedTitle,extractedAuthor,result.url(),publishedAt,"PRIVATE","",cleanedBody,coverUrl);
    }
    private static String formatByteSize(int bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024f)) + " KB";
        return String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024.0));
    }
    private Map<String, Object> saveInNewTransaction(Draft draft, Principal principal) {
        if (transactionManager != null) {
            saveInNewTx.set(Boolean.TRUE);
            try {
                return save(null, draft, principal);
            } finally {
                saveInNewTx.remove();
            }
        }
        return save(null, draft, principal);
    }
    private static String clampText(String value, int maxLength) {
        if (value == null) return "";
        if (value.length() <= maxLength) return value;
        int end = maxLength;
        if (end > 0 && Character.isHighSurrogate(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(0, end);
    }
    private static String fallbackTitle(String resolvedUrl, String rawUrl) {
        String candidate = resolvedUrl != null && !resolvedUrl.isBlank() ? resolvedUrl : rawUrl;
        try {
            var uri = java.net.URI.create(candidate);
            if (uri.getHost() != null && !uri.getHost().isBlank()) {
                return clampText(uri.getHost(), 300);
            }
        } catch (IllegalArgumentException ignored) {}
        return clampText(candidate, 300);
    }
    private String captureCover(org.jsoup.nodes.Document document,Element body,String base,Principal principal) {
        for(var meta:document.select("meta[property=og:image],meta[property=twitter:image],meta[name=twitter:image]")) {
            var source=resolveImageUrl(base,meta.attr("content"));
            if(source==null)continue;
            try {
                var download=web.get(source.toString(),MAX_COVER_BYTES);
                UUID id=asset(download.bytes(),principal);
                var matches=new HashSet<java.net.URI>();
                matches.add(source);
                var finalUrl=resolveImageUrl(base,download.url());
                if(finalUrl!=null)matches.add(finalUrl);
                removeCapturedCoverImages(body,base,matches);
                return assetUrl(id);
            } catch(Exception failed) {
                // The social preview is optional; keep the article body available when its cover cannot be captured.
            }
        }
        return null;
    }
    private static java.net.URI resolveImageUrl(String base,String value) {
        if(value==null||value.isBlank())return null;
        try {
            var uri=java.net.URI.create(base).resolve(value.trim()).normalize();
            if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)return null;
            return uri;
        } catch(IllegalArgumentException invalidUrl) { return null; }
    }
    private static void removeCapturedCoverImages(Element body,String base,Set<java.net.URI> coverUrls) {
        for(var image:new ArrayList<>(body.select("img"))) {
            String source=image.hasAttr("data-src")&&!image.attr("data-src").isBlank()?image.attr("data-src"):image.attr("src");
            var imageUrl=resolveImageUrl(base,source);
            if(imageUrl!=null&&coverUrls.contains(imageUrl))image.remove();
        }
    }
    public static String sanitize(String html) {
        var doc=Jsoup.parseBodyFragment(Jsoup.clean(html,"https://humite.invalid",SAFE_HTML));
        for(var node:new ArrayList<>(doc.body().childNodes()))if(node instanceof org.jsoup.nodes.TextNode text && !text.isBlank())text.wrap("<p></p>");
        int i=0;
        for(var el:doc.body().getAllElements()) {
            StringBuilder style=new StringBuilder();
            for(String rule:el.attr("style").split(";")) {
                String value=rule.trim();
                if(SAFE_CSS_RULE.matcher(value).matches())style.append(value).append(';');
            }
            el.removeAttr("style");if(!style.isEmpty())el.attr("style",style.toString());
            el.removeAttr("id");
            if(PARAGRAPH_ID_TAGS.contains(el.tagName()))el.attr("id","p-"+(++i));
            if(el.tagName().equals("a"))el.attr("rel","noreferrer noopener").attr("target","_blank");
        }
        return doc.body().html();
    }
    public String clean(String html,String base,Principal principal) {
        return clean(html, base, principal, null);
    }
    private String clean(String html, String base, Principal principal, ImageProgressCallback onImage) {
        if(html==null||html.length()>30_000_000)throw ApiException.badRequest("ARTICLE_SIZE","文章正文过大或为空。");
        var doc=Jsoup.parseBodyFragment(html,base==null?"":base);
        doc.select("script,iframe,form,object,embed,video,audio").remove();
        for(var style:doc.select("style"))if(style.closest("svg")==null)style.remove();
        var media = new ArrayList<Element>();
        for(var candidate:new ArrayList<>(doc.select("img,svg"))) {
            if(candidate.parents().stream().anyMatch(parent->parent.tagName().equals("svg")))continue;
            if(media.size() < 40) media.add(candidate);
            else candidate.remove();
        }
        int total = media.size();
        if (total == 0 && onImage != null) {
            onImage.onImage(0, 0);
        }
        for(int index = 0; index < total; index++) {
            var image = media.get(index);
            if (onImage != null) {
                onImage.onImage(index + 1, total);
            }
            try {
                if(image.tagName().equals("svg")) {
                    String alt=image.attr("aria-roledescription").startsWith("flowchart")?"文章流程图":"文章插图";
                    UUID id=asset(ArticleSvgRasterizer.rasterize(image),principal);
                    image.replaceWith(new Element("img").attr("src","/api/v1/articles/assets/"+id)
                            .attr("alt",alt).attr("loading","lazy"));
                    continue;
                }
                String src=image.hasAttr("data-src")?image.attr("data-src"):image.attr("src");
                String alt=image.attr("alt");
                var assetMatch=INTERNAL_ASSET_URL.matcher(src);
                if(assetMatch.matches()) {
                    UUID id=UUID.fromString(assetMatch.group(1));
                    this.image(id,principal);
                } else {
                    byte[] bytes;
                    if(src.startsWith("data:image/")&&src.contains(";base64,")) {
                        if(src.length()>8_000_000)throw new IOException();
                        bytes=Base64.getDecoder().decode(src.substring(src.indexOf(',')+1));
                    } else { bytes=web.get(java.net.URI.create(base==null?"":base).resolve(src).toString(),MAX_COVER_BYTES).bytes(); }
                    src="/api/v1/articles/assets/"+asset(bytes,principal);
                }
                image.clearAttributes();image.attr("src",src).attr("loading","lazy");
                if(!alt.isBlank())image.attr("alt",alt);
            } catch(Exception failed){image.replaceWith(new Element("p").text("[图片未能导入]"));}
        }
        return sanitize(doc.body().html());
    }
    public UUID asset(byte[] bytes,Principal principal) throws IOException {
        var user=manager(principal);if(bytes.length>5*1024*1024)throw new IOException("Image too large");
        // 先限制尺寸再解码；保存规范化的无主动内容位图。
        // Decode only after dimensions have been bounded; persist a normalized raster without active content.
        try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers=ImageIO.getImageReaders(stream);if(!readers.hasNext())throw new IOException("Unsupported image");
            var reader=readers.next();try {
                reader.setInput(stream);int w=reader.getWidth(0),h=reader.getHeight(0);
                if(w<=0||h<=0||(long)w*h>20_000_000)throw new IOException("Too many pixels");
                var out=new ByteArrayOutputStream();ImageIO.write(reader.read(0),"png",out);UUID id=UUID.randomUUID();
                files.create("articles",user.id(),id,new ByteArrayInputStream(out.toByteArray()),25*1024*1024);
                db.execute("insert into article_assets(id,owner_id,mime) values (?,?,'image/png')",id,user.id());return id;
            }finally{reader.dispose();}
        }
    }
    public org.springframework.core.io.Resource image(UUID id,Principal principal)throws IOException {
        var user=actor(principal);
        var row=db.fetchOne("select owner_id from article_assets where id=? and (owner_id=? or exists(select 1 from article_asset_links l join articles a on a.id=l.article_id where l.asset_id=? and (a.visibility='PUBLIC' or a.owner_id=? or ?)))",id,user.id(),id,user.id(),user.canManageFiles());
        if(row==null)throw ApiException.notFound("ASSET_NOT_FOUND","图片不存在。");return files.resource("articles",row.get("owner_id",UUID.class),id);
    }
    public Map<String, Object> save(UUID id, Draft input, Principal principal) {
        var user = manager(principal);
        UUID articleId = id == null ? UUID.randomUUID() : id;
        if (id != null) get(articleId, principal);
        if (input.title() == null || input.title().isBlank() || input.title().length() > 300) {
            throw ApiException.badRequest("TITLE_REQUIRED", "请输入不超过 300 字的标题。");
        }
        if (!Set.of("PUBLIC", "PRIVATE").contains(input.visibility())) {
            throw ApiException.badRequest("VISIBILITY", "可见范围无效。");
        }
        rejectDuplicateSource(input.sourceUrl(), articleId);
        // Perform HTML sanitization, image downloading, hashing, and cover transcoding outside any DB lock/transaction.
        String html = clean(input.html(), input.sourceUrl(), principal);
        String sourceKey = ArticleIdentity.sourceKey(input.sourceUrl());
        String contentKey = articleContentKey(html, principal);
        UUID coverAsset = normalizeCover(input.coverUrl(), principal);
        boolean requireNew = Boolean.TRUE.equals(saveInNewTx.get());
        return executeSaveTransaction(requireNew, () ->
                persistSavedArticle(articleId, user, input, html, sourceKey, contentKey, coverAsset, principal));
    }

    private <T> T executeSaveTransaction(boolean requireNew, java.util.function.Supplier<T> action) {
        if (transactionManager != null) {
            var template = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
            if (requireNew) {
                template.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            }
            return template.execute(status -> action.get());
        }
        return action.get();
    }

    private Map<String, Object> persistSavedArticle(UUID id, HumiteUser user, Draft input, String html,
                                                    String sourceKey, String contentKey, UUID coverAsset, Principal principal) {
        // Serialize duplicate check and upsert across API instances without locking reads on articles.
        db.execute("select pg_advisory_xact_lock(hashtext('humite:articles:save'))");
        for (var legacy : db.fetch("select id,source_url,html from articles where duplicate_source_key is null or duplicate_content_key is null")) {
            db.execute("update articles set duplicate_source_key=?,duplicate_content_key=? where id=?",
                    ArticleIdentity.sourceKey(legacy.get("source_url", String.class)),
                    articleContentKey(legacy.get("html", String.class), principal),
                    legacy.get("id", UUID.class));
        }
        if (!sourceKey.isEmpty() && db.fetchExists(db.selectOne().from("articles").where("id<>? and duplicate_source_key=?", id, sourceKey))) {
            throw duplicateArticle("已有相同来源链接的文章，请在文章列表中查看或编辑。");
        }
        if (!contentKey.isEmpty() && db.fetchExists(db.selectOne().from("articles").where("id<>? and duplicate_content_key=?", id, contentKey))) {
            throw duplicateArticle("已有相同正文的文章，无需重复导入。");
        }
        db.execute("insert into articles(id,owner_id,title,author,source_url,published_at,visibility,tags,html,cover_asset_id) values (?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set title=excluded.title,author=excluded.author,source_url=excluded.source_url,published_at=excluded.published_at,visibility=excluded.visibility,tags=excluded.tags,html=excluded.html,cover_asset_id=excluded.cover_asset_id,knowledge='[]',knowledge_revision=null,updated_at=now()",
                id, user.id(), input.title(), input.author(), input.sourceUrl(), input.publishedAt(), input.visibility(), input.tags(), html, coverAsset);
        db.execute("update articles set duplicate_source_key=?,duplicate_content_key=? where id=?", sourceKey, contentKey, id);
        db.execute("delete from article_asset_links where article_id=?", id);
        for (var image : Jsoup.parseBodyFragment(html).select("img")) {
            var match = INTERNAL_ASSET_URL.matcher(image.attr("src"));
            if (match.matches()) {
                db.execute("insert into article_asset_links(article_id, asset_id) values (?,?) on conflict do nothing", id, UUID.fromString(match.group(1)));
            }
        }
        if (coverAsset != null) {
            db.execute("insert into article_asset_links(article_id, asset_id) values (?,?) on conflict do nothing", id, coverAsset);
        }
        return get(id, principal);
    }
    private static ApiException duplicateArticle(String message) {
        return ApiException.conflict("ARTICLE_DUPLICATE",message);
    }
    private void rejectDuplicateSource(String source,UUID excluded) {
        String key=ArticleIdentity.sourceKey(source);
        if(key.isEmpty())return;
        // Legacy URLs are checked before capture too, without downloading the webpage or its assets.
        for(var row:db.fetch("select id,source_url from articles where duplicate_source_key=? or duplicate_source_key is null",key)) {
            if(!Objects.equals(excluded,row.get("id",UUID.class))&&key.equals(ArticleIdentity.sourceKey(row.get("source_url",String.class))))
                throw duplicateArticle("已有相同来源链接的文章，请在文章列表中查看或编辑。");
        }
    }
    private String articleContentKey(String html,Principal principal) {
        return ArticleIdentity.contentKey(html,source->{
            var match=INTERNAL_ASSET_URL.matcher(source);
            if(match.matches())try {
                var resource=image(UUID.fromString(match.group(1)),principal);
                if(resource!=null)try(var stream=resource.getInputStream()) {
                    var digest=java.security.MessageDigest.getInstance("SHA-256");
                    try(var hashed=new java.security.DigestInputStream(stream,digest)) { hashed.transferTo(OutputStream.nullOutputStream()); }
                    return HexFormat.of().formatHex(digest.digest());
                }
            } catch(java.security.NoSuchAlgorithmException impossible) {
                throw new IllegalStateException(impossible);
            } catch(IOException|ApiException unavailable) {
                // Preserve imports with a missing legacy image; its stored reference remains distinct.
            }
            return source;
        });
    }
    private UUID normalizeCover(String coverUrl,Principal principal) {
        if(coverUrl==null||coverUrl.isBlank())return null;
        var internal=INTERNAL_ASSET_URL.matcher(coverUrl);
        if(internal.matches()) {
            UUID id=UUID.fromString(internal.group(1));
            try { image(id,principal); }
            catch(IOException inaccessible) { throw ApiException.notFound("ASSET_NOT_FOUND","封面图片不存在或无权访问。"); }
            return id;
        }
        if(!coverUrl.startsWith("data:image/")||!coverUrl.contains(";base64,"))
            throw ApiException.badRequest("COVER_INVALID","封面必须是图片或已授权的文章图片资源。");
        if(coverUrl.length()>8_000_000)throw ApiException.badRequest("COVER_INVALID","封面图片过大或格式无效。");
        String mediaType=coverUrl.substring("data:".length(),coverUrl.indexOf(';'));
        if(!SAFE_DATA_IMAGE_MIME.matcher(mediaType).matches())throw ApiException.badRequest("COVER_INVALID","请选择 JPEG、PNG 或 WebP 封面。");
        try {
            byte[] bytes=Base64.getDecoder().decode(coverUrl.substring(coverUrl.indexOf(',')+1));
            return asset(bytes,principal);
        } catch(IllegalArgumentException|IOException invalidImage) {
            throw ApiException.badRequest("COVER_INVALID","封面图片无法读取或格式不受支持。");
        }
    }
    @Transactional public void delete(UUID id,Principal p){manager(p);requireAccessible(id,p);db.execute("delete from articles where id=?",id);}
    public Map<String,Object> reading(UUID id,Principal p) {
        get(id,p);var row=db.fetchOne("select state::text,revision from article_reading where article_id=? and user_id=?",id,actor(p).id());
        return row==null?Map.of("state","{}","revision",0):row.intoMap();
    }
    @Transactional public void reading(UUID id,String state,long revision,Principal p) {
        get(id,p);if(state==null||state.length()>1_000_000)throw ApiException.badRequest("STATE_SIZE","阅读记录过大。");
        if (permissions != null && articleAnnotationsChanged(id, state, p)) permissions.require(p, "articles.annotate");
        // Like ordinary book positions, the last submitted state wins for this user.
        // Keep revision as a server counter and accept older clients' revision fields.
        db.execute("insert into article_reading(article_id,user_id,state,revision) values (?,?,?::jsonb,1) on conflict(article_id,user_id) do update set state=excluded.state,revision=article_reading.revision+1",id,actor(p).id(),state);
    }
    private boolean articleAnnotationsChanged(UUID id, String nextState, Principal principal) {
        var row = db.fetchOne("select state::text from article_reading where article_id=? and user_id=?", id, actor(principal).id());
        String currentState = row == null ? "{}" : row.get("state", String.class);
        try {
            var current = json.readTree(currentState == null ? "{}" : currentState);
            var next = json.readTree(nextState);
            var currentAnnotations = current != null && current.isObject() ? current.path("annotations") : null;
            var nextAnnotations = next != null && next.isObject() ? next.path("annotations") : null;
            var empty = json.createArrayNode();
            return !(currentAnnotations != null && currentAnnotations.isArray() ? currentAnnotations : empty)
                    .equals(nextAnnotations != null && nextAnnotations.isArray() ? nextAnnotations : empty);
        } catch (tools.jackson.core.JacksonException invalid) {
            throw ApiException.badRequest("READING_STATE_INVALID", "文章阅读记录格式无效。");
        }
    }
    public List<Map<String,Object>> knowledge(Principal p) {
        var user=actor(p);return db.fetch("select id,title,knowledge::text as points from articles where visibility='PUBLIC' or owner_id=? or ?",user.id(),user.canManageFiles()).intoMaps();
    }
    public void generate(UUID id,Principal p) throws Exception {
        throw new ApiException(HttpStatus.GONE,"ARTICLE_AI_DISABLED","文章 AI 功能已停用。");
    }
}
