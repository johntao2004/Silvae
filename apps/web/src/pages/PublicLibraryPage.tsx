// 公共首页只消费公开展示目录，管理入口不改变匿名数据可见范围。
// The public homepage consumes display-catalog data only; management links do not expand anonymous visibility.
import { useDeferredValue } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { usePermissions } from "../auth/permissions";
import { BookCardPresentation } from "../components/BookCardPresentation";
import { LibraryCatalogView, useCatalogInfiniteQuery } from "../components/LibraryCatalogView";
import type { DisplayBook } from "../domain/types";
import { useCatalogFilterParams } from "../hooks/useCatalogFilterParams";

export function PublicLibraryPage() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canQuery = !user || can("library.query");
  const filterParams = useCatalogFilterParams();
  const { query, categoryId, subjectCode, format, sort, activeCount } = filterParams;
  const deferredQuery = useDeferredValue(query);
  const {
    query: displayQuery,
    entries: bookEntries,
    items: books,
    loadNextPage,
    triggerRef,
    automaticLoadingSupported,
  } = useCatalogInfiniteQuery({
    queryKey: ["display-books", deferredQuery, categoryId, subjectCode, format, sort, user?.id ?? "anonymous"],
    enabled: canQuery,
    queryFn: ({ pageParam, signal }) => api.listDisplayBooks({
      q: deferredQuery.trim() || undefined,
      categoryId: categoryId || undefined,
      subjectCode: subjectCode || undefined,
      format: format === "ALL" ? undefined : format as "EPUB" | "PDF",
      sort,
      cursor: pageParam,
      limit: 36,
      signal,
    }),
  });

  return (
    <LibraryCatalogView
      sectionTitle="公开藏书"
      canQuery={canQuery}
      filterParams={filterParams}
      entries={bookEntries}
      hasData={Boolean(displayQuery.data)}
      isPending={displayQuery.isPending}
      isError={displayQuery.isError}
      hasNextPage={Boolean(displayQuery.hasNextPage)}
      isFetchingNextPage={displayQuery.isFetchingNextPage}
      isFetchNextPageError={displayQuery.isFetchNextPageError}
      automaticLoadingSupported={automaticLoadingSupported}
      triggerRef={triggerRef}
      onLoadMore={loadNextPage}
      onRetryNextPage={() => void displayQuery.fetchNextPage()}
      summaryText={activeCount > 0 ? `已加载 ${books.length} 本匹配藏书` : undefined}
      noQueryPermissionMessage="当前角色没有查询书籍目录的权限。"
      loadingLabel="正在加载公开藏书"
      loadErrorMessage="公开藏书暂时无法读取，请稍后刷新。"
      nextPageErrorMessage="更多展示书目加载失败，请重试。"
      scrollHintText="继续向下浏览，将自动加载更多书目"
      emptyTitle={activeCount ? "未找到匹配的书籍" : "暂无公开书籍"}
      renderBookCard={book => <PublicBookCard book={book} />}
    />
  );
}

function PublicBookCard({ book }: { book: DisplayBook }) {
  const navigate = useNavigate();
  const location = useLocation();
  const openDetails = () => navigate(`/library/books/${book.id}`, { state: { bookReturnTo: location.pathname + location.search } });
  return <BookCardPresentation book={book} onOpen={openDetails} onRead={openDetails} primaryActionLabel="前往详情页" />;
}
