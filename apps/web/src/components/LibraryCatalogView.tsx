import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode, type RefObject } from "react";
import { Alert, CircularProgress } from "@/ui/feedback";
import { Button } from "@/ui/buttons";
import { Box, Stack, Typography } from "@/ui/primitives";
import { useCatalogFilterParams } from "../hooks/useCatalogFilterParams";
import { useInfiniteScrollTrigger } from "../hooks/useInfiniteScrollTrigger";
import { tokens } from "../theme/tokens";
import { BookCatalogEmptyState } from "./BookCatalogEmptyState";
import { bookGridSx } from "./bookGrid";
import { BookGridSkeleton } from "./BookGridSkeleton";
import { CatalogAdvancedFilters, CatalogAdvancedFilterToggle } from "./CatalogAdvancedFilters";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogSection } from "./CatalogSection";
import { LibraryPageHeader, LibraryScopeFilter } from "./LibraryPageHeader";
import { PageContainer } from "./PageHeader";
import { flattenUniquePaginatedItems, PaginatedItemReveal, type PaginatedItem } from "./PaginatedItemReveal";

const FORMAT_FILTER_OPTIONS = [
  { value: "ALL", label: "全部格式" },
  { value: "EPUB", label: "EPUB" },
  { value: "PDF", label: "PDF" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "最近入库" },
  { value: "title", label: "按书名" },
  { value: "author", label: "按作者" },
];

export function useCatalogInfiniteQuery<TBook extends { id: string }>({
  queryKey,
  enabled,
  queryFn,
  filterItem,
}: {
  queryKey: readonly unknown[];
  enabled: boolean;
  queryFn: (context: { pageParam: string | undefined; signal: AbortSignal }) => Promise<{ items: TBook[]; nextCursor?: string }>;
  filterItem?: (item: TBook) => boolean;
}) {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => queryFn({ pageParam, signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: 15_000,
  });

  const entries = useMemo(() => {
    const raw = flattenUniquePaginatedItems(query.data?.pages);
    return filterItem ? raw.filter(({ item }) => filterItem(item)) : raw;
  }, [filterItem, query.data]);

  const items = useMemo(() => entries.map(({ item }) => item), [entries]);

  const loadNextPage = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const { triggerRef, supported: automaticLoadingSupported } = useInfiniteScrollTrigger({
    enabled: Boolean(query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError),
    onLoadMore: loadNextPage,
  });

  return {
    query,
    entries,
    items,
    loadNextPage,
    triggerRef,
    automaticLoadingSupported,
  };
}

export interface LibraryCatalogViewProps<TBook extends { id: string }> {
  sectionTitle: string;
  canQuery: boolean;
  filterParams: ReturnType<typeof useCatalogFilterParams>;
  actions?: ReactNode;
  beforeSection?: ReactNode;
  entries: readonly PaginatedItem<TBook>[];
  hasData: boolean;
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  automaticLoadingSupported: boolean;
  triggerRef: RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  onRetryNextPage: () => void;
  summaryText?: string;
  noQueryPermissionMessage: string;
  loadingLabel: string;
  loadingMoreLabel?: string;
  loadErrorMessage: string;
  nextPageErrorMessage: string;
  scrollHintText: string;
  emptyTitle: string;
  suppressEmptyState?: boolean;
  footerText?: string;
  renderBookCard: (book: TBook) => ReactNode;
  afterContainer?: ReactNode;
}

export function LibraryCatalogView<TBook extends { id: string }>({
  sectionTitle,
  canQuery,
  filterParams,
  actions,
  beforeSection,
  entries,
  hasData,
  isPending,
  isError,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  automaticLoadingSupported,
  triggerRef,
  onLoadMore,
  onRetryNextPage,
  summaryText,
  noQueryPermissionMessage,
  loadingLabel,
  loadingMoreLabel = "正在加载更多藏书",
  loadErrorMessage,
  nextPageErrorMessage,
  scrollHintText,
  emptyTitle,
  suppressEmptyState = false,
  footerText,
  renderBookCard,
  afterContainer,
}: LibraryCatalogViewProps<TBook>) {
  const { categoryId, subjectCode, format, sort, updateParam, clearFilters, activeCount } = filterParams;

  return (
    <>
      <PageContainer>
        <LibraryPageHeader />
        {beforeSection}
        <CatalogSection
          title={sectionTitle}
          tools={
            <CatalogFilters
              extraFilterCount={Number(Boolean(subjectCode)) + Number(Boolean(categoryId))}
              extraTools={(
                <Stack direction="row" sx={{ flexWrap: "wrap", gap: `${tokens.spacing[3]}px` }}>
                  <LibraryScopeFilter />
                  {canQuery && <CatalogAdvancedFilterToggle />}
                </Stack>
              )}
              actions={actions}
              filter={canQuery ? {
                label: "格式",
                value: format,
                onChange: value => updateParam("format", value, "ALL"),
                options: FORMAT_FILTER_OPTIONS,
              } : undefined}
              sort={canQuery ? {
                label: "排序",
                value: sort,
                onChange: value => updateParam("sort", value, "recent"),
                options: SORT_OPTIONS,
              } : undefined}
            />
          }
        >
          {canQuery && <CatalogAdvancedFilters />}
          {activeCount > 0 && summaryText && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{summaryText}</Typography>
          )}
          {!canQuery ? (
            <Alert severity="info">{noQueryPermissionMessage}</Alert>
          ) : isPending ? (
            <BookGridSkeleton label={loadingLabel} />
          ) : isError && !hasData ? (
            <Alert severity="error">{loadErrorMessage}</Alert>
          ) : entries.length === 0 ? (
            suppressEmptyState ? null : (
              <BookCatalogEmptyState
                title={emptyTitle}
                action={activeCount ? <Button variant="outlined" onClick={clearFilters}>清除筛选</Button> : undefined}
              />
            )
          ) : (
            <Box sx={bookGridSx}>
              {entries.map(({ item, pageIndex, itemIndex }) => (
                <PaginatedItemReveal key={item.id} animate={pageIndex > 0} order={itemIndex}>
                  {renderBookCard(item)}
                </PaginatedItemReveal>
              ))}
            </Box>
          )}
          {(hasNextPage || isFetchingNextPage) && !isFetchNextPageError && (
            <Stack ref={triggerRef} role="status" aria-live="polite" sx={{ minHeight: 96, alignItems: "center", justifyContent: "center", mt: 3 }}>
              {isFetchingNextPage ? (
                <CircularProgress size={22} aria-label={loadingMoreLabel} />
              ) : automaticLoadingSupported ? (
                <Typography variant="caption" color="text.disabled">{scrollHintText}</Typography>
              ) : (
                <Button variant="outlined" onClick={onLoadMore}>继续加载</Button>
              )}
            </Stack>
          )}
          {isFetchNextPageError && (
            <Alert
              severity="warning"
              sx={{ mt: 4 }}
              action={<Button color="inherit" onClick={onRetryNextPage}>重新加载</Button>}
            >
              {nextPageErrorMessage}
            </Alert>
          )}
          {footerText && (
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", textAlign: "center", mt: 6 }}>
              {footerText}
            </Typography>
          )}
        </CatalogSection>
      </PageContainer>
      {afterContainer}
    </>
  );
}
