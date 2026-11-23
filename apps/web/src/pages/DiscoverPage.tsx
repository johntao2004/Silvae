import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { usePermissions } from "../auth/permissions";
import { BookCatalogEmptyState } from "../components/BookCatalogEmptyState";
import { BooklistFormDialog } from "../components/BooklistFormDialog";
import { ArticleCollectionGrid, BooklistSection } from "../components/CatalogDiscoveryCards";
import { CatalogSection } from "../components/CatalogSection";
import { PageContainer, PageHeader } from "../components/PageHeader";
import { articleCollections } from "../features/article-collections/api";
import { ArticleCollectionFormDialog } from "../features/article-collections/ArticleCollectionFormDialog";
import { tokens } from "../theme/tokens";
import { Button } from "@/ui/buttons";
import { Alert, CircularProgress } from "@/ui/feedback";
import { Box, Snackbar, Stack, Typography } from "@/ui/primitives";
import { EMPTY_BOOKLISTS_TITLE } from "../ui/empty-state-copy";
import { RequestErrorPage } from "./HttpErrorPage";

type DiscoverTab = "all" | "booklists" | "collections";

export function DiscoverPage() {
  const { user, ready } = useAuth();
  const { can, canVisit } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [createBooklistOpen, setCreateBooklistOpen] = useState(false);
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const canViewBooklists = !user || canVisit("/booklists");
  const canViewCollections = Boolean(user && can("articles.collections.view"));
  const canCreateBooklist = Boolean(user && canViewBooklists && can("booklists.edit"));
  const canCreateCollection = Boolean(user && canViewCollections && can("articles.collections.edit"));

  const rawTab = params.get("tab");
  const activeTab: DiscoverTab =
    rawTab === "collections" && canViewCollections
      ? "collections"
      : rawTab === "booklists" && canViewBooklists
        ? "booklists"
        : "all";

  const tabs: Array<{ key: DiscoverTab; label: string }> = [
    { key: "all", label: "全部" },
    ...(canViewBooklists ? [{ key: "booklists" as const, label: "书单" }] : []),
    ...(canViewCollections ? [{ key: "collections" as const, label: "文章合集" }] : []),
  ];

  const selectTab = (nextTab: DiscoverTab) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextTab === "all") next.delete("tab");
      else next.set("tab", nextTab);
      return next;
    }, { replace: true });
  };

  const showBooklists = canViewBooklists && (activeTab === "all" || activeTab === "booklists");
  const showCollections = canViewCollections && (activeTab === "all" || activeTab === "collections");

  const audienceKey = user?.id ?? "anonymous";
  const booklistsQuery = useQuery({
    queryKey: ["booklists", audienceKey, ""],
    queryFn: ({ signal }) => api.listBooklists({ signal }),
    enabled: ready && canViewBooklists,
  });

  const collectionsQuery = useQuery({
    queryKey: ["article-collections", user?.id],
    queryFn: ({ signal }) => articleCollections.list({ signal }),
    enabled: ready && canViewCollections,
  });

  const allBooklists = booklistsQuery.data?.items ?? [];
  const mineBooklists = useMemo(
    () => (user ? allBooklists.filter((booklist) => booklist.ownedByViewer && booklist.visibility === "PRIVATE") : []),
    [allBooklists, user],
  );
  const familyBooklists = useMemo(
    () => (user ? allBooklists.filter((booklist) => booklist.visibility === "MEMBERS") : []),
    [allBooklists, user],
  );
  const publicBooklists = useMemo(
    () => allBooklists.filter((booklist) => booklist.visibility === "PUBLIC"),
    [allBooklists],
  );

  const allCollections = collectionsQuery.data?.items ?? [];
  const mineCollections = useMemo(
    () => allCollections.filter((collection) => collection.ownedByViewer && collection.visibility === "PRIVATE"),
    [allCollections],
  );
  const sharedCollections = useMemo(
    () => allCollections.filter((collection) => collection.visibility === "MEMBERS"),
    [allCollections],
  );

  if (!canViewBooklists && !canViewCollections) return null;

  const booklistsFailed = showBooklists && booklistsQuery.isError && !booklistsQuery.data;
  const collectionsFailed = showCollections && collectionsQuery.isError && !collectionsQuery.data;
  if (
    (showBooklists || showCollections)
    && (!showBooklists || booklistsFailed)
    && (!showCollections || collectionsFailed)
  ) {
    const primaryError = booklistsFailed ? booklistsQuery.error : collectionsQuery.error;
    const retrying = (showBooklists && booklistsQuery.isFetching) || (showCollections && collectionsQuery.isFetching);
    return (
      <RequestErrorPage
        error={primaryError}
        retrying={retrying}
        onRetry={() => {
          if (showBooklists) void booklistsQuery.refetch();
          if (showCollections) void collectionsQuery.refetch();
        }}
      />
    );
  }

  const returnTo = `${location.pathname}${location.search}`;
  const headerAction = (canCreateBooklist || canCreateCollection) ? (
    <Stack direction="row" sx={{ gap: 1, flexWrap: "nowrap", alignItems: "center" }}>
      {canCreateBooklist ? (
        <Button variant="contained" size="small" sx={{ whiteSpace: "nowrap" }} onClick={() => setCreateBooklistOpen(true)}>
          新建书单
        </Button>
      ) : null}
      {canCreateCollection ? (
        <Button
          variant={canCreateBooklist ? "outlined" : "contained"}
          size="small"
          sx={{ whiteSpace: "nowrap" }}
          onClick={() => setCreateCollectionOpen(true)}
        >
          新建合集
        </Button>
      ) : null}
    </Stack>
  ) : undefined;

  return (
    <PageContainer>
      <PageHeader eyebrow="DISCOVER" title="发现" action={headerAction} />

      <Box role="tablist" aria-label="发现内容筛选" className="bk-discover-tabs">
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`bk-discover-tab${selected ? " bk-discover-tab--active" : ""}`}
              onClick={() => selectTab(tab.key)}
            >
              {tab.label}
            </button>
          );
        })}
      </Box>

      <Stack sx={{ gap: { xs: "28px", md: `${tokens.spacing[16]}px` } }}>
        {showBooklists ? (
          booklistsQuery.isPending ? (
            <Stack role="status" aria-label="正在加载书单" sx={{ alignItems: "center", py: `${tokens.spacing[12]}px` }}>
              <CircularProgress />
              <Typography color="text.secondary" sx={{ mt: 2 }}>正在展开书单…</Typography>
            </Stack>
          ) : booklistsQuery.isError ? (
            <Alert severity="error" action={<Button color="inherit" onClick={() => void booklistsQuery.refetch()}>重试</Button>}>
              书单暂时无法读取。
            </Alert>
          ) : (
            <Stack sx={{ gap: { xs: "28px", md: `${tokens.spacing[16]}px` } }}>
              {user ? <BooklistSection title="我的书单" items={mineBooklists} emptyTitle={EMPTY_BOOKLISTS_TITLE} /> : null}
              {user ? <BooklistSection title="家庭共享" items={familyBooklists} emptyTitle="暂无家庭共享书单" /> : null}
              <BooklistSection title="公开书单" items={publicBooklists} emptyTitle="暂无公开书单" />
            </Stack>
          )
        ) : null}

        {showCollections ? (
          collectionsQuery.isPending ? (
            <Stack role="status" aria-label="正在加载合集" sx={{ alignItems: "center", py: `${tokens.spacing[12]}px` }}>
              <CircularProgress />
            </Stack>
          ) : collectionsQuery.isError ? (
            <Alert severity="error" action={<Button color="inherit" onClick={() => void collectionsQuery.refetch()}>重试</Button>}>
              暂时无法加载合集。
            </Alert>
          ) : (
            <Stack sx={{ gap: { xs: "24px", md: `${tokens.spacing[10]}px` } }}>
              <CatalogSection title="我的私密合集">
                {mineCollections.length ? (
                  <ArticleCollectionGrid items={mineCollections} returnTo={returnTo} />
                ) : (
                  <BookCatalogEmptyState title="还没有私密合集" />
                )}
              </CatalogSection>
              <CatalogSection title="成员共享合集">
                {sharedCollections.length ? (
                  <ArticleCollectionGrid items={sharedCollections} returnTo={returnTo} />
                ) : (
                  <BookCatalogEmptyState title="还没有共享合集" />
                )}
              </CatalogSection>
            </Stack>
          )
        ) : null}
      </Stack>

      {canCreateBooklist ? (
        <BooklistFormDialog
          open={createBooklistOpen}
          onClose={() => setCreateBooklistOpen(false)}
          onSaved={(_booklist, message) => {
            setCreateBooklistOpen(false);
            setNotice(message);
            void queryClient.invalidateQueries({ queryKey: ["booklists"] });
          }}
        />
      ) : null}

      {canCreateCollection ? (
        <ArticleCollectionFormDialog
          open={createCollectionOpen}
          onClose={() => setCreateCollectionOpen(false)}
          onSaved={(collection, message) => {
            setCreateCollectionOpen(false);
            setNotice(message);
            void queryClient.invalidateQueries({ queryKey: ["article-collections"] });
            const from = new URLSearchParams({ from: returnTo });
            navigate(
              { pathname: `/article-collections/${encodeURIComponent(collection.id)}`, search: `?${from.toString()}` },
              { state: { returnTo } },
            );
          }}
        />
      ) : null}

      <Snackbar open={Boolean(notice)} autoHideDuration={4200} onClose={() => setNotice("")} message={notice} />
    </PageContainer>
  );
}
