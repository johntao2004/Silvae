package com.elexvx.humite.articles;

import com.elexvx.humite.users.HumiteUser;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** Persistence boundary for article collections; authorization decisions stay in the application service. */
@Repository
public class ArticleCollectionRepository {
    private final DSLContext db;

    public ArticleCollectionRepository(DSLContext db) {
        this.db = db;
    }

    public record CollectionRow(UUID id, UUID ownerId, String title, String description, String visibility,
                                long revision, OffsetDateTime createdAt, OffsetDateTime updatedAt,
                                String ownerDisplayName) {}
    public record ArticleRow(UUID id, String title, String author, String sourceUrl, String publishedAt,
                             String visibility, String tags, String coverUrl,
                             OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
    public record ArticleSource(UUID id, UUID ownerId, String visibility) {}

    public List<CollectionRow> findReadableCollections(HumiteUser viewer, String q) {
        var rows = db.fetch("""
                select c.id, c.owner_id, c.title, c.description, c.visibility, c.revision,
                       c.created_at, c.updated_at, u.display_name as owner_display_name
                  from article_collections c
                  join app_users u on u.id = c.owner_id
                 where (c.owner_id = ? or c.visibility = 'MEMBERS')
                 and (cast(? as text) is null or c.title ilike '%' || ? || '%' or c.description ilike '%' || ? || '%')
                 order by c.updated_at desc, c.id
                """, viewer.id(), q, q, q);
        return rows.map(this::collectionRow);
    }

    public CollectionRow findReadableCollection(UUID id, HumiteUser viewer) {
        var row = db.fetchOne("""
                select c.id, c.owner_id, c.title, c.description, c.visibility, c.revision,
                       c.created_at, c.updated_at, u.display_name as owner_display_name
                  from article_collections c
                  join app_users u on u.id = c.owner_id
                 where c.id = ? and (c.owner_id = ? or c.visibility = 'MEMBERS')
                """, id, viewer.id());
        return row == null ? null : collectionRow(row);
    }

    public CollectionRow findCollection(UUID id) {
        var row = db.fetchOne("""
                select c.id, c.owner_id, c.title, c.description, c.visibility, c.revision,
                       c.created_at, c.updated_at, u.display_name as owner_display_name
                  from article_collections c
                  join app_users u on u.id = c.owner_id
                 where c.id = ?
                """, id);
        return row == null ? null : collectionRow(row);
    }

    public List<ArticleRow> findVisibleArticles(CollectionRow collection, HumiteUser viewer) {
        String access = "MEMBERS".equals(collection.visibility()) && !collection.ownerId().equals(viewer.id())
                ? "a.visibility = 'PUBLIC'"
                : "(a.visibility = 'PUBLIC' or a.owner_id = ? or ? )";
        String sql = """
                select a.id, a.title, a.author, a.source_url, a.published_at, a.visibility, a.tags,
                       case when a.cover_asset_id is null then null else '/api/v1/articles/assets/' || a.cover_asset_id::text end as cover_url,
                       a.created_at, a.updated_at
                  from article_collection_articles ca
                  join articles a on a.id = ca.article_id
                 where ca.collection_id = ? and %s
                 order by ca.position, ca.article_id
                """.formatted(access);
        boolean publicOnly = "MEMBERS".equals(collection.visibility()) && !collection.ownerId().equals(viewer.id());
        var rows = publicOnly
                ? db.fetch(sql, collection.id())
                : db.fetch(sql, collection.id(), viewer.id(), viewer.canManageFiles());
        var result = new ArrayList<ArticleRow>(rows.size());
        for (var row : rows) {
            result.add(articleRow(row));
        }
        return List.copyOf(result);
    }

    public List<UUID> findRelatedIds(UUID collectionId) {
        return db.fetch("select article_id from article_collection_articles where collection_id=? order by position, article_id", collectionId)
                .getValues("article_id", UUID.class);
    }

    public List<UUID> findHiddenRelatedIds(CollectionRow collection, HumiteUser viewer) {
        boolean publicOnly = "MEMBERS".equals(collection.visibility()) && !collection.ownerId().equals(viewer.id());
        String access = publicOnly
                ? "a.visibility = 'PUBLIC'"
                : "(a.visibility = 'PUBLIC' or a.owner_id = ? or ? )";
        String sql = "select ca.article_id from article_collection_articles ca join articles a on a.id=ca.article_id "
                + "where ca.collection_id=? and not (" + access + ") order by ca.position, ca.article_id";
        return publicOnly
                ? db.fetch(sql, collection.id()).getValues("article_id", UUID.class)
                : db.fetch(sql, collection.id(), viewer.id(), viewer.canManageFiles()).getValues("article_id", UUID.class);
    }

    public List<ArticleSource> findSources(List<UUID> articleIds, HumiteUser viewer, boolean onlyPublic, boolean lock) {
        if (articleIds.isEmpty()) return List.of();
        String sql = "select id, owner_id, visibility from articles where id in (" + placeholders(articleIds.size()) + ")";
        var args = new ArrayList<Object>(articleIds);
        if (onlyPublic) sql += " and visibility='PUBLIC'";
        else {
            sql += " and (visibility='PUBLIC' or owner_id=? or ?)";
            args.add(viewer.id());
            args.add(viewer.canManageFiles());
        }
        if (lock) sql += " for share";
        return db.fetch(sql, args.toArray()).map(row -> new ArticleSource(
                row.get("id", UUID.class), row.get("owner_id", UUID.class), row.get("visibility", String.class)));
    }

    public UUID insertCollection(UUID ownerId, String title, String description, String visibility) {
        UUID id = UUID.randomUUID();
        db.execute("insert into article_collections(id,owner_id,title,description,visibility) values (?,?,?,?,?)",
                id, ownerId, title, description, visibility);
        return id;
    }

    public boolean updateCollection(UUID id, UUID ownerId, long revision, String title, String description, String visibility) {
        return db.execute("""
                update article_collections set title=?, description=?, visibility=?, revision=revision+1, updated_at=now()
                 where id=? and owner_id=? and revision=?
                """, title, description, visibility, id, ownerId, revision) == 1;
    }

    public boolean bumpRevision(UUID id, UUID ownerId, long revision) {
        return db.execute("update article_collections set revision=revision+1, updated_at=now() where id=? and owner_id=? and revision=?",
                id, ownerId, revision) == 1;
    }

    public void insertRelations(UUID collectionId, List<UUID> articleIds, int startPosition) {
        if (articleIds.isEmpty()) return;
        Integer[] positions = new Integer[articleIds.size()];
        for (int index = 0; index < articleIds.size(); index++) positions[index] = startPosition + index;
        db.execute("""
                insert into article_collection_articles(collection_id, article_id, position)
                select ?, item.article_id, item.position
                  from unnest(?::uuid[], ?::int[]) as item(article_id, position)
                """, collectionId, articleIds.toArray(UUID[]::new), positions);
    }

    public boolean deleteRelation(UUID collectionId, UUID articleId) {
        return db.execute("delete from article_collection_articles where collection_id=? and article_id=?", collectionId, articleId) == 1;
    }

    public void rewriteOrder(UUID collectionId, List<UUID> orderedIds) {
        if (orderedIds.isEmpty()) return;
        db.execute("delete from article_collection_articles where collection_id=?", collectionId);
        insertRelations(collectionId, orderedIds, 0);
    }

    public java.util.Map<UUID, Integer> countVisibleArticlesByCollection(List<UUID> collectionIds, HumiteUser viewer) {
        if (collectionIds.isEmpty()) return java.util.Map.of();
        var rows = db.fetch("""
                select ca.collection_id, count(*)::int as article_count
                  from article_collection_articles ca
                  join article_collections c on c.id = ca.collection_id
                  join articles a on a.id = ca.article_id
                 where ca.collection_id = any(?::uuid[])
                   and (a.visibility = 'PUBLIC'
                     or (not (c.visibility = 'MEMBERS' and c.owner_id <> ?)
                         and (a.owner_id = ? or ?)))
                 group by ca.collection_id
                """, (Object) collectionIds.toArray(UUID[]::new), viewer.id(), viewer.id(), viewer.canManageFiles());
        var counts = new java.util.HashMap<UUID, Integer>();
        for (var row : rows) {
            counts.put(row.get("collection_id", UUID.class), row.get("article_count", Integer.class));
        }
        return counts;
    }

    public java.util.Map<UUID, List<ArticleRow>> previewVisibleArticlesByCollection(List<UUID> collectionIds, HumiteUser viewer, int perCollection) {
        if (collectionIds.isEmpty() || perCollection <= 0) return java.util.Map.of();
        var rows = db.fetch("""
                select ranked.collection_id, ranked.id, ranked.title, ranked.author, ranked.source_url,
                       ranked.published_at, ranked.visibility, ranked.tags, ranked.cover_url,
                       ranked.created_at, ranked.updated_at
                  from (
                    select ca.collection_id, a.id, a.title, a.author, a.source_url, a.published_at, a.visibility, a.tags,
                           case when a.cover_asset_id is null then null else '/api/v1/articles/assets/' || a.cover_asset_id::text end as cover_url,
                           a.created_at, a.updated_at,
                           row_number() over (partition by ca.collection_id order by ca.position, ca.article_id) as rn
                      from article_collection_articles ca
                      join article_collections c on c.id = ca.collection_id
                      join articles a on a.id = ca.article_id
                     where ca.collection_id = any(?::uuid[])
                       and (a.visibility = 'PUBLIC'
                         or (not (c.visibility = 'MEMBERS' and c.owner_id <> ?)
                             and (a.owner_id = ? or ?)))
                  ) ranked
                 where ranked.rn <= ?
                 order by ranked.collection_id, ranked.rn
                """, (Object) collectionIds.toArray(UUID[]::new), viewer.id(), viewer.id(), viewer.canManageFiles(), perCollection);
        var result = new java.util.HashMap<UUID, ArrayList<ArticleRow>>();
        for (var row : rows) {
            UUID collectionId = row.get("collection_id", UUID.class);
            result.computeIfAbsent(collectionId, ignored -> new ArrayList<>(perCollection)).add(articleRow(row));
        }
        return result.entrySet().stream().collect(
                java.util.stream.Collectors.toUnmodifiableMap(java.util.Map.Entry::getKey, e -> List.copyOf(e.getValue())));
    }

    public boolean deleteCollection(UUID id, UUID ownerId, long revision) {
        return db.execute("delete from article_collections where id=? and owner_id=? and revision=?", id, ownerId, revision) == 1;
    }

    private CollectionRow collectionRow(Record row) {
        return new CollectionRow(row.get("id", UUID.class), row.get("owner_id", UUID.class),
                row.get("title", String.class), row.get("description", String.class), row.get("visibility", String.class),
                row.get("revision", Long.class), row.get("created_at", OffsetDateTime.class),
                row.get("updated_at", OffsetDateTime.class), row.get("owner_display_name", String.class));
    }

    private ArticleRow articleRow(Record row) {
        return new ArticleRow(row.get("id", UUID.class), row.get("title", String.class), row.get("author", String.class),
                row.get("source_url", String.class), row.get("published_at", String.class), row.get("visibility", String.class),
                row.get("tags", String.class), row.get("cover_url", String.class),
                row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class));
    }

    private static String placeholders(int count) {
        return String.join(",", java.util.Collections.nCopies(count, "?"));
    }
}
