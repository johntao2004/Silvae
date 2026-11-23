import { usePermissions } from "../auth/permissions";
import { EmptyState } from "../ui/empty-state";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageContainer, PageHeader } from "../components/PageHeader";
import { BookCardPresentation } from "../components/BookCardPresentation";
import { articleGridSx, bookGridSx } from "../components/bookGrid";
import { Alert } from "@/ui/feedback";
import { Button } from "@/ui/buttons";
import { Box, Stack, Typography } from "@/ui/primitives";
import type { Book, BookPage, DisplayBook, DisplayBookPage } from "../domain/types";
import { articleCollections } from "../features/article-collections/api";
import { articles } from "../features/content/api";
import { articleNotesApi } from "../features/notes/api";
import { collectNotes, noteSourceHref } from "../features/notes/note-records";
import { postHref, postLabels, readingPosts } from "../features/notes/posts-api";
import { tokens } from "../theme/tokens";
import { knowledgeKey } from "./knowledge-graph-model";

export function SearchPage() {
  const { user, ready } = useAuth();
  const { can } = usePermissions();
  const canSearch = !user || can("library.search.view");
  const canQueryPrivateLibrary = !user || can("library.query");
  const showArticles = Boolean(user) && can("articles.view");
  const showArticleCollections = Boolean(user) && can("articles.collections.view");
  const showNotes = Boolean(user) && can("notes.view");
  const showArticleNotes = Boolean(user) && can("notes.articles.view");
  const showPosts = Boolean(user) && can("notes.posts.view");
  const showBooklists = !user || can("booklists.view");
  const showKnowledge = Boolean(user) && can("knowledge.view");
  const [params] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const audience = user?.id ?? "anonymous";
  const enabled = ready && canSearch && Boolean(query);
  const matches = (values: (string | null | undefined)[]) =>
    values.filter(Boolean).join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase());
  // 各搜索源保留服务端可见性规则；匿名用户不请求私人目录或批注，且缓存键不得跨身份共用。
  // Every source keeps its server-side visibility rules. Never query the private
  // catalog or annotations for anonymous visitors, or share their cache keys.
  const books = useInfiniteQuery({
    queryKey: ["global-search-books", audience, query], enabled: enabled && canQueryPrivateLibrary,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<BookPage | DisplayBookPage> => {
      const input = { q: query, cursor: pageParam, limit: 24, signal };
      if (user) {
        const page = await api.listBooks(input);
        return { ...page, items: page.items.map((book, index) => ({ ...book, available: true, sortOrder: index })) };
      }
      return api.listDisplayBooks(input);
    },
    getNextPageParam: page => page.nextCursor,
  });
  const articleResults = useQuery({ queryKey: ["global-search-articles", audience], queryFn: () => articles.list(), enabled: enabled && showArticles });
  const articleCollectionResults = useQuery({ queryKey: ["global-search-article-collections", audience, query], queryFn: ({ signal }) => articleCollections.list({ q: query, signal }), enabled: enabled && showArticleCollections });
  const notes = useQuery({ queryKey: ["global-search-notes", audience, query], queryFn: () => api.listAnnotations(undefined, query), enabled: enabled && showNotes });
  const articleNotes = useQuery({ queryKey: ["global-search-article-notes", audience], queryFn: () => articleNotesApi.list(), enabled: enabled && showArticleNotes });
  const posts = useQuery({ queryKey: ["global-search-posts", audience], queryFn: () => readingPosts.list("ALL"), enabled: enabled && showPosts });
  const lists = useQuery({ queryKey: ["global-search-booklists", audience, query], queryFn: ({ signal }) => api.listBooklists({ q: query, signal }), enabled: enabled && showBooklists });
  const knowledge = useQuery({ queryKey: ["global-search-knowledge", audience], queryFn: ({ signal }) => api.listBookKnowledge(signal), enabled: enabled && showKnowledge });
  const bookItems = books.data?.pages.flatMap<Book | DisplayBook>(page => page.items) ?? [];
  const articleItems = showArticles
    ? (articleResults.data ?? []).filter(article => matches([article.title, article.author, article.source_url, article.tags, article.excerpt]))
    : [];
  const articleCollectionItems = showArticleCollections ? articleCollectionResults.data?.items ?? [] : [];
  const noteItems = showNotes ? (notes.data ?? []).filter(note => matches([note.bookTitle, note.bookAuthor, note.quote, note.note])) : [];
  const articleNoteItems = showArticleNotes
    ? collectNotes([], articleNotes.data ?? []).filter(note => matches([note.sourceTitle, note.author, note.quote, note.note]))
    : [];
  const postItems = showPosts
    ? (posts.data?.items ?? []).filter(post => matches([post.title, post.sourceTitle, post.authorName, post.excerpt]))
    : [];
  const knowledgeItems = showKnowledge
    ? [...(knowledge.data ?? []).reduce((map, entry) => {
      for (const point of entry.points) {
        if (!point.name.trim() || !matches([point.name, point.quote])) continue;
        const key = knowledgeKey(point.name);
        const current = map.get(key);
        if (current) {
          current.bookIds.add(entry.bookId);
          if (!current.quote && point.quote) current.quote = point.quote;
        } else {
          map.set(key, { key, name: point.name, quote: point.quote, bookIds: new Set([entry.bookId]) });
        }
      }
      return map;
    }, new Map<string, { key: string; name: string; quote: string; bookIds: Set<string> }>()).values()]
    : [];
  const knowledgeHref = (name: string) => `/knowledge-graph?${new URLSearchParams({ q: name }).toString()}`;
  const queries = [
    ...(canQueryPrivateLibrary ? [books] : []),
    ...(showArticles ? [articleResults] : []),
    ...(showArticleCollections ? [articleCollectionResults] : []),
    ...(showNotes ? [notes] : []),
    ...(showArticleNotes ? [articleNotes] : []),
    ...(showPosts ? [posts] : []),
    ...(showBooklists ? [lists] : []),
    ...(showKnowledge ? [knowledge] : []),
  ];
  const listItems = showBooklists ? lists.data?.items ?? [] : [];
  const loading = enabled && queries.some(result => result.isPending);
  const failed = enabled && queries.some(result => result.isError);
  const empty = !bookItems.length && !articleItems.length && !articleCollectionItems.length
    && !noteItems.length && !articleNoteItems.length && !postItems.length
    && !listItems.length && !knowledgeItems.length;
  const sectionSx = { gap: `${tokens.spacing[4]}px`, mt: `${tokens.spacing[8]}px` };
  return <PageContainer>
    <PageHeader title="搜索" />
    {!query ? <Typography color="text.secondary">在顶部搜索框输入关键词，按回车开始搜索。</Typography> : <>
      <Typography color="text.secondary">“{query}”的搜索结果</Typography>
      {user && !canQueryPrivateLibrary && <Alert severity="info">当前账号没有搜索书籍的权限。</Alert>}
      {loading && <Typography role="status" sx={{ mt: `${tokens.spacing[4]}px` }}>正在搜索…</Typography>}
      {failed && <Alert severity="warning" action={<Button onClick={() => { queries.forEach(result => { if (result.isError) void result.refetch(); }); }}>重试</Button>}>部分内容暂时无法搜索，已显示可用结果。</Alert>}
      {!loading && !failed && empty && <EmptyState title="未找到相关内容" />}
      {Boolean(bookItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">书籍</Typography>
        <Box sx={bookGridSx}>{bookItems.map(book => <BookCardPresentation key={book.id} book={book} />)}</Box>
        {books.hasNextPage && <Button disabled={books.isFetchingNextPage} onClick={() => void books.fetchNextPage()}>加载更多</Button>}
      </Stack>}
      {Boolean(articleItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">文章</Typography>
        <Box sx={articleGridSx}>{articleItems.map(article => <BookCardPresentation
          key={article.id}
          variant="article"
          href={`/articles/${encodeURIComponent(article.id)}`}
          book={{ id: article.id, title: article.title, author: article.author || "未知作者", coverUrl: article.cover_url || undefined }}
          description={article.excerpt}
          status={article.visibility === "PUBLIC" ? "书库成员可见" : "私密文章"}
        />)}</Box>
      </Stack>}
      {Boolean(articleCollectionItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">文章合集</Typography>
        {articleCollectionItems.map(collection => <SearchResultItem
          key={collection.id}
          title={collection.title}
          subtitle={`${collection.articleCount} 篇文章${collection.ownerDisplayName ? ` · ${collection.ownerDisplayName}` : ""}`}
          excerpt={collection.description}
          to={`/article-collections/${encodeURIComponent(collection.id)}`}
          actionLabel="查看合集"
        />)}
      </Stack>}
      {Boolean(noteItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">书籍笔记</Typography>
        {noteItems.length >= 500 && <Typography color="text.secondary">匹配内容较多，当前显示前 500 条；请使用更具体的关键词。</Typography>}
        {noteItems.map(note => <SearchResultItem
          key={note.id}
          title={note.bookTitle ?? "阅读笔记"}
          subtitle={note.quote}
          excerpt={note.note}
          to={note.locator ? `/reader/${note.bookId}?locator=${encodeURIComponent(note.locator)}` : `/annotations?bookId=${note.bookId}`}
          actionLabel="查看笔记"
        />)}
      </Stack>}
      {Boolean(articleNoteItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">文章笔记</Typography>
        {articleNoteItems.map(note => <SearchResultItem
          key={`${note.sourceId}:${note.id}`}
          title={note.sourceTitle}
          subtitle={note.quote}
          excerpt={note.note}
          to={noteSourceHref(note)}
          actionLabel="查看笔记"
        />)}
      </Stack>}
      {Boolean(postItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">阅读随笔</Typography>
        {postItems.map(post => <SearchResultItem
          key={`${post.kind}:${post.id}`}
          title={post.title}
          subtitle={`${postLabels[post.kind]} · ${post.sourceTitle}${post.authorName ? ` · ${post.authorName}` : ""}`}
          excerpt={post.excerpt}
          to={postHref(post)}
          actionLabel="查看随笔"
        />)}
      </Stack>}
      {Boolean(listItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">书单</Typography>
        {listItems.map(list => <Button key={list.id} component={Link} to={`/booklists/${list.id}`} sx={{ alignSelf: "flex-start" }}>{list.title}</Button>)}
      </Stack>}
      {Boolean(knowledgeItems.length) && <Stack component="section" sx={sectionSx}>
        <Typography component="h2" variant="h4">知识点</Typography>
        {knowledgeItems.map(point => <SearchResultItem
          key={point.key}
          title={point.name}
          subtitle={`${point.bookIds.size} 本相关书籍`}
          excerpt={point.quote}
          to={knowledgeHref(point.name)}
          actionLabel="在知识图谱中查看"
        />)}
      </Stack>}
    </>}
  </PageContainer>;
}

function SearchResultItem({ title, subtitle, excerpt, to, actionLabel }: {
  title: string;
  subtitle?: string;
  excerpt?: string;
  to: string;
  actionLabel: string;
}) {
  return <Box sx={{ borderBottom: "1px solid", borderColor: "divider", pb: `${tokens.spacing[4]}px` }}>
    <Typography component="h3" variant="h6">{title}</Typography>
    {subtitle && <Typography>{subtitle}</Typography>}
    {excerpt && <Typography color="text.secondary">{excerpt}</Typography>}
    <Button component={Link} to={to} sx={{ mt: `${tokens.spacing[3]}px` }}>{actionLabel}</Button>
  </Box>;
}
