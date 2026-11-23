import { RequestErrorPage } from "./HttpErrorPage";
import { BookCatalogEmptyState } from "../components/BookCatalogEmptyState";
import { BookCardPresentation } from "../components/BookCardPresentation";
import { CatalogSection } from "../components/CatalogSection";
import { PageBackAction, PageContainer, PageTitle } from "../components/PageHeader";
import { articleGridSx } from "../components/bookGrid";
import { useAuth } from "../auth/AuthContext";
import { usePermissions } from "../auth/permissions";
import { Alert, Chip, CircularProgress } from "@/ui/feedback";
import { Box, Breadcrumbs, Link as UiLink, Snackbar, Stack, Typography } from "@/ui/primitives";
import { Button } from "@/ui/buttons";
import { LockOutlined, PeopleAltOutlined } from "@/ui/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArticleCollectionFormDialog } from "../features/article-collections/ArticleCollectionFormDialog";
import { ArticleCollectionOrganizerDrawer } from "../features/article-collections/ArticleCollectionOrganizerDrawer";
import { ArticleCollectionPreview } from "../features/article-collections/ArticleCollectionPreview";
import { articleCollections, type ArticleCollectionDetail } from "../features/article-collections/api";
import { tokens } from "../theme/tokens";

export function ArticleCollectionDetailPage() {
  const { collectionId = "" } = useParams();
  const { user, ready } = useAuth();
  const { can } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const query = params.get("q") ?? "";
  const deferredQuery = useDeferredValue(query);
  const audienceId = user?.id;
  const returnTo = safeReturnTo((location.state as { returnTo?: string } | null)?.returnTo ?? params.get("from"));
  const detailKey = ["article-collection", collectionId, audienceId];
  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => articleCollections.get(collectionId),
    enabled: ready && Boolean(user) && can("articles.collections.details.view") && Boolean(collectionId),
  });

  const updateDetail = async (collection: ArticleCollectionDetail, message: string) => {
    queryClient.setQueryData(detailKey, collection);
    setNotice(message);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["article-collections"] }),
      queryClient.invalidateQueries({ queryKey: ["article-collection", collectionId] }),
      queryClient.invalidateQueries({ queryKey: ["articles"] }),
    ]);
  };

  const updateQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  };

  if (!user || !can("articles.collections.details.view")) return null;
  if (detailQuery.isPending) return <PageContainer><PageBackAction to={returnTo}>返回合集列表</PageBackAction><Stack role="status" aria-label="正在加载合集" sx={{ alignItems: "center", py: `${tokens.spacing[20]}px` }}><CircularProgress /></Stack></PageContainer>;
  if (detailQuery.isError || !detailQuery.data) return <RequestErrorPage error={detailQuery.error} retrying={detailQuery.isFetching} onRetry={() => void detailQuery.refetch()} back={<PageBackAction to={returnTo}>返回合集列表</PageBackAction>} />;

  const collection = detailQuery.data;
  const mayEdit = collection.editable && can("articles.collections.edit");
  const hiddenPrivateCount = collection.visibility === "MEMBERS" && !collection.ownedByViewer
    ? collection.articles.filter((article) => article.visibility === "PRIVATE").length
    : 0;
  const visibleArticles = collection.visibility === "MEMBERS" && !collection.ownedByViewer
    ? collection.articles.filter((article) => article.visibility !== "PRIVATE")
    : collection.articles;
  const matching = visibleArticles.filter((article) => `${article.title} ${article.author} ${article.source_url} ${article.tags} ${article.excerpt ?? ""}`.toLocaleLowerCase().includes(deferredQuery.trim().toLocaleLowerCase()));
  const hasPrivateArticles = collection.articles.some((article) => article.visibility === "PRIVATE");

  return <PageContainer>
    <Stack direction="row" sx={{ alignItems: "center", gap: "12px", mb: `${tokens.spacing[5]}px`, minWidth: 0 }}>
      <PageBackAction inline to={returnTo}>返回合集列表</PageBackAction>
      <Breadcrumbs sx={{ mb: 0, minWidth: 0 }}>
        <UiLink component={Link} to={returnTo} underline="hover" color="inherit">合集</UiLink>
        <Typography color="text.primary" sx={{ overflowWrap: "anywhere" }}>{collection.title}</Typography>
      </Breadcrumbs>
    </Stack>
    <Box component="header" sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: `minmax(${tokens.layout.bookCardMinWidth}px, ${tokens.spacing[24] * 3}px) minmax(0, 1fr)` }, alignItems: "center", gap: { xs: `${tokens.spacing[5]}px`, md: `${tokens.spacing[10]}px` }, mb: `${tokens.spacing[10]}px` }}>
      <ArticleCollectionPreview articles={collection.articles.filter((article) => collection.ownedByViewer || collection.visibility !== "MEMBERS" || article.visibility !== "PRIVATE")} title={collection.title} emptyLabel="合集里还没有文章" />
      <Stack sx={{ minWidth: 0, gap: `${tokens.spacing[4]}px` }}>
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: `${tokens.spacing[2]}px` }}>
          <Typography variant="overline" color="primary.main">ARTICLE COLLECTION</Typography>
          <Chip size="small" variant="outlined" icon={collection.visibility === "PRIVATE" ? <LockOutlined /> : <PeopleAltOutlined />} label={collection.visibility === "PRIVATE" ? "仅自己可见" : "书库成员可见"} />
        </Stack>
        <PageTitle>{collection.title}</PageTitle>
        <Typography color="text.secondary" sx={{ maxWidth: tokens.layout.readingMax, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{collection.description || "暂无合集说明。"}</Typography>
        <Typography variant="body2" color="text.secondary">{collection.ownerDisplayName ? `由 ${collection.ownerDisplayName} 创建` : "合集"} · {collection.articleCount} 篇文章</Typography>
        {mayEdit && <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: `${tokens.spacing[3]}px`, mt: `${tokens.spacing[2]}px`, alignItems: { xs: "stretch", sm: "center" } }}>
          <Button variant="contained" onClick={() => setOrganizerOpen(true)}>管理文章</Button>
          <Button variant="outlined" onClick={() => setEditOpen(true)}>编辑合集</Button>
        </Stack>}
      </Stack>
    </Box>
    {hiddenPrivateCount > 0 && <Alert severity="warning" sx={{ mb: `${tokens.spacing[6]}px` }}>这个合集里有 {hiddenPrivateCount} 篇私密文章，其他成员看不到。你可以移出这些文章，或将合集设为私密。</Alert>}
    {mayEdit && collection.visibility === "MEMBERS" && hasPrivateArticles && <Alert severity="warning" sx={{ mb: `${tokens.spacing[6]}px` }}>请先移出私密文章，再保存为共享合集。</Alert>}
    <CatalogSection title="合集文章">
      {matching.length ? <Box component="section" aria-label="合集文章列表" sx={articleGridSx}>
        {matching.map((article) => <BookCardPresentation
          key={article.id}
          variant="article"
          href={`/articles/${encodeURIComponent(article.id)}`}
          book={{ id: article.id, title: article.title, author: article.author || "未知作者", coverUrl: article.cover_url || undefined }}
          description={article.excerpt}
          status={article.visibility === "PUBLIC" ? "书库成员可见" : "私密文章"}
        />)}
      </Box> : <BookCatalogEmptyState title={query ? "没有找到匹配的文章" : "合集里还没有文章"} action={mayEdit && !query ? <Button variant="contained" onClick={() => setOrganizerOpen(true)}>添加文章</Button> : query ? <Button onClick={() => updateQuery("")}>清除搜索</Button> : undefined} />}
    </CatalogSection>
    {mayEdit && <ArticleCollectionOrganizerDrawer open={organizerOpen} collection={collection} onClose={() => setOrganizerOpen(false)} onChanged={(next, message) => { void updateDetail(next, message); }} />}
    {mayEdit && <ArticleCollectionFormDialog open={editOpen} initial={collection} hasPrivateArticles={hasPrivateArticles} onClose={() => setEditOpen(false)} onConflictLatest={(latest) => { queryClient.setQueryData(detailKey, latest); }} onSaved={(next, message) => { setEditOpen(false); void updateDetail(next, message); }} onDeleted={(message) => {
      setEditOpen(false);
      setNotice(message);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["article-collections"] }),
        queryClient.invalidateQueries({ queryKey: ["article-collection", collectionId] }),
      ]);
      navigate(returnTo);
    }} />}
    <Snackbar open={Boolean(notice)} autoHideDuration={4200} onClose={() => setNotice("")} message={notice} />
  </PageContainer>;
}

function safeReturnTo(value: string | null | undefined) {
  if (value === "/discover" || value?.startsWith("/discover?")) return value;
  return "/discover?tab=collections";
}
