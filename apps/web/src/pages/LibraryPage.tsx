import { RequestErrorPage } from "./HttpErrorPage";
import { usePermissions } from "../auth/permissions";
import { BookGridSkeleton } from "../components/BookGridSkeleton";
import { KeyboardArrowUpRounded } from "@/ui/icons";
import { CircularProgress } from "@/ui/feedback";
import { Box, Snackbar, Stack, Typography, type UiTheme } from "@/ui/primitives";
import { Button, Fab } from "@/ui/buttons";
import { Tooltip } from "@/ui/feedback";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useCatalogFilterParams } from "../hooks/useCatalogFilterParams";
import { BookCard } from "../components/BookCard";
import { bookGridSx } from "../components/bookGrid";
import { AddToBooklistDialog } from "../components/AddToBooklistDialog";
import { BookUploadDialog } from "../components/BookUploadDialog";
import { useConfirmation } from "../ui/confirmations";
import { BookUploadDraftCard } from "../components/BookUploadDraftCard";
import { FileOperationDialog } from "../components/FileOperationDialog";
import { LibraryCatalogView, useCatalogInfiniteQuery } from "../components/LibraryCatalogView";
import { PageContainer } from "../components/PageHeader";
import { PublicLibraryPage } from "./PublicLibraryPage";
import type { Book, BookUpload, FileOperationType } from "../domain/types";
import { matchesThema } from "../domain/thema";
import { tokens } from "../theme/tokens";
import { EMPTY_CATALOG_TITLE } from "../ui/empty-state-copy";

export function LibraryPage() {
  const { user, ready } = useAuth();
  const [params] = useSearchParams();
  if (!ready) return <PageContainer><BookGridSkeleton label="正在加载藏书" /></PageContainer>;
  return user && params.get("scope") !== "public" ? <MemberLibraryPage key={user.id} /> : <PublicLibraryPage />;
}

function MemberLibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const filterParams = useCatalogFilterParams();
  const { query: rawQuery, categoryId, subjectCode, format, sort, activeCount } = filterParams;
  const location = useLocation();
  const [operation, setOperation] = useState<{ book: Book; type: FileOperationType } | null>(null);
  const editMetadata = (book: Book) => navigate(`/library/books/${book.id}/edit`, { state: { bookReturnTo: `${location.pathname}${location.search}` } });
  const [booklistBook, setBooklistBook] = useState<Book | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [notice, setNotice] = useState("");
  const confirmation = useConfirmation();
  const deleteDraft = (id: string) => confirmation.confirm({
    title: "删除这份待完善书籍？",
    content: "上传文件和已填写的草稿资料将被删除。",
    okText: "删除",
    cancelText: "取消",
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await api.cancelBookUpload(id);
        queryClient.setQueryData<BookUpload[]>(["book-uploads", user?.id],
          current => current?.filter(upload => upload.id !== id));
        await queryClient.invalidateQueries({ queryKey: ["book-uploads"] });
        setNotice("草稿已删除");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "草稿删除失败，请重试。");
        throw error;
      }
    },
  });
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN");
  const deferredQuery = useDeferredValue(query);
  const { can } = usePermissions();
  const canUpload = can("library.upload");
  const canQuery = can("library.query");
  const uploadsQuery = useQuery({
    queryKey: ["book-uploads", user?.id],
    queryFn: api.listBookUploads,
    enabled: Boolean(user?.id && canUpload),
    retry: false,
    refetchInterval: queryState => queryState.state.data?.some(upload =>
      upload.status === "RECEIVING" || upload.status === "INSPECTING" || upload.status === "ENRICHING" || upload.status === "COMMITTING",
    ) ? 1200 : false,
  });

  const isAvailableBook = useCallback((book: Book) => book.status === "AVAILABLE", []);

  // 查询键包含检索、格式和排序；请求接收取消信号，游标页属于该组查询条件。
  // The query key includes search, format and sort; requests receive cancellation signals and cursor pages belong to those filters.
  const {
    query: booksQuery,
    entries: bookEntries,
    items: books,
    loadNextPage,
    triggerRef,
    automaticLoadingSupported,
  } = useCatalogInfiniteQuery({
    queryKey: ["books", deferredQuery, format, sort, categoryId, subjectCode, user?.id],
    enabled: canQuery,
    queryFn: ({ pageParam, signal }) => api.listBooks({
      q: deferredQuery || undefined,
      categoryId: categoryId || undefined,
      subjectCode: subjectCode || undefined,
      format: format === "ALL" ? undefined : format as "EPUB" | "PDF",
      sort,
      cursor: pageParam,
      limit: 36,
      signal,
    }),
    filterItem: isAvailableBook,
  });

  useEffect(() => {
    const updateBackToTopVisibility = () => {
      const nextVisible = window.scrollY > tokens.spacing[20];
      setShowBackToTop((currentVisible) => currentVisible === nextVisible ? currentVisible : nextVisible);
    };

    updateBackToTopVisibility();
    window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateBackToTopVisibility);
  }, []);

  const readyUploadDrafts = useMemo(() => (uploadsQuery.data ?? []).filter(upload => upload.status === "READY_FOR_REVIEW"), [uploadsQuery.data]);
  const hasReadyUploadDrafts = canUpload && readyUploadDrafts.length > 0;
  const filteredUploadDrafts = useMemo(() => {
    if (!canUpload || categoryId) return [];
    const matching = readyUploadDrafts.filter(upload => {
      const metadata = upload.draftMetadata ?? upload.detectedMetadata;
      const subjectCodes = upload.draftMetadata?.subjectCodes ?? upload.detectedMetadata?.subjectCodes;
      const searchText = [upload.originalFilename, metadata?.title, metadata?.subtitle, ...(metadata?.authors ?? []), ...(metadata?.tags ?? []), metadata?.description]
        .filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
      return (!deferredQuery || searchText.includes(deferredQuery))
        && (format === "ALL" || upload.format === format)
        && matchesThema(subjectCodes, subjectCode);
    });
    return matching.sort((left, right) => {
      const leftMetadata = left.draftMetadata ?? left.detectedMetadata;
      const rightMetadata = right.draftMetadata ?? right.detectedMetadata;
      if (sort === "title") return (leftMetadata?.title ?? left.originalFilename).localeCompare(rightMetadata?.title ?? right.originalFilename, "zh-CN");
      if (sort === "author") return (leftMetadata?.authors.join(" / ") ?? "").localeCompare(rightMetadata?.authors.join(" / ") ?? "", "zh-CN");
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [canUpload, categoryId, deferredQuery, format, readyUploadDrafts, sort, subjectCode]);

  if (booksQuery.isError && !booksQuery.data) return <RequestErrorPage error={booksQuery.error} retrying={booksQuery.isFetching} onRetry={() => void booksQuery.refetch()} />;

  const emptyTitle = activeCount
    ? (hasReadyUploadDrafts ? "未找到匹配的已入库书籍" : "未找到匹配的书籍")
    : (hasReadyUploadDrafts || (canUpload && uploadsQuery.isError) ? "暂无已入库书籍" : EMPTY_CATALOG_TITLE);

  return (
    <LibraryCatalogView
      sectionTitle="全部藏书"
      canQuery={canQuery}
      filterParams={filterParams}
      actions={can("library.upload") ? <Button variant="contained" onClick={() => setUploadOpen(true)} sx={{ whiteSpace: "nowrap" }}>上传书籍</Button> : undefined}
      beforeSection={
        <>
          {canUpload && uploadsQuery.isError && (
            <Stack role="alert" sx={{ alignItems: "flex-start", gap: `${tokens.spacing[3]}px`, mb: `${tokens.spacing[4]}px` }}>
              <Typography color="error.main">草稿暂时无法读取，已入库书籍仍可继续浏览。</Typography>
              <Button variant="outlined" disabled={uploadsQuery.isFetching} onClick={() => void uploadsQuery.refetch()}>
                {uploadsQuery.isFetching ? "正在重试" : "重试"}
              </Button>
            </Stack>
          )}
          {canUpload && uploadsQuery.isPending && (
            <Stack role="status" aria-label="正在读取书籍草稿" sx={{ minHeight: `${tokens.spacing[16]}px`, alignItems: "center", justifyContent: "center", mb: `${tokens.spacing[4]}px` }}>
              <CircularProgress aria-label="正在读取书籍草稿" />
            </Stack>
          )}
          {filteredUploadDrafts.length > 0 && (
            <Stack component="section" aria-label="待完善资料" spacing={2} sx={{ mb: `${tokens.spacing[6]}px` }}>
              <Typography variant="h5" component="h2">待完善资料</Typography>
              <Box sx={bookGridSx}>
                {filteredUploadDrafts.map(upload => (
                  <BookUploadDraftCard
                    key={upload.id}
                    upload={upload}
                    onDelete={() => deleteDraft(upload.id)}
                    onOpen={() => navigate(`/library/uploads/${upload.id}`, { state: { bookReturnTo: `${location.pathname}${location.search}` } })}
                  />
                ))}
              </Box>
            </Stack>
          )}
        </>
      }
      entries={bookEntries}
      hasData={Boolean(booksQuery.data)}
      isPending={booksQuery.isPending}
      isError={booksQuery.isError}
      hasNextPage={Boolean(booksQuery.hasNextPage)}
      isFetchingNextPage={booksQuery.isFetchingNextPage}
      isFetchNextPageError={booksQuery.isFetchNextPageError}
      automaticLoadingSupported={automaticLoadingSupported}
      triggerRef={triggerRef}
      onLoadMore={loadNextPage}
      onRetryNextPage={() => void booksQuery.fetchNextPage()}
      summaryText={activeCount > 0 ? (query ? `找到 ${books.length} 本已入库藏书` : `已加载 ${books.length} 本已入库藏书`) : undefined}
      noQueryPermissionMessage="当前角色没有查询书籍目录的权限。可切换到公开藏书范围查询公开书籍。"
      loadingLabel="正在加载藏书"
      loadErrorMessage="书库暂时无法读取，请检查网络与书库连接。"
      nextPageErrorMessage="更多藏书加载失败，已经显示的书籍不受影响。"
      scrollHintText="继续向下浏览，将自动加载更多藏书"
      emptyTitle={emptyTitle}
      suppressEmptyState={canUpload && uploadsQuery.isPending}
      footerText={!booksQuery.hasNextPage && books.length > 36 ? `已加载全部 ${books.length} 本藏书` : undefined}
      renderBookCard={book => (
        <BookCard
          book={book}
          onOpen={(selected) => navigate(`/library/books/${selected.id}`, { state: { bookReturnTo: location.pathname + location.search } })}
          onRead={(selected) => navigate(`/reader/${selected.id}`)}
          onAddToBooklist={can("booklists.edit") ? setBooklistBook : undefined}
          onEditMetadata={can("library.edit") ? editMetadata : undefined}
          onFileOperation={can("library.files") || can("library.trash") ? (selected, type) => setOperation({ book: selected, type }) : undefined}
        />
      )}
      afterContainer={
        <>
          <AddToBooklistDialog
            open={Boolean(booklistBook)}
            bookId={booklistBook?.id ?? ""}
            bookTitle={booklistBook?.title ?? ""}
            onClose={() => setBooklistBook(null)}
            onCompleted={(message) => { setBooklistBook(null); setNotice(message); }}
          />
          <FileOperationDialog
            book={operation?.book ?? null}
            type={operation?.type ?? null}
            onClose={() => setOperation(null)}
            onCompleted={(result) => {
              setNotice(result.status === "SUCCEEDED" ? `任务已完成：${result.stage ?? result.status}` : "文件任务已提交，可在「文件操作记录」中查看进度");
              void queryClient.invalidateQueries({ queryKey: ["books"] });
              void queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
            }}
          />
          <BookUploadDialog
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onCompleted={(message) => { setNotice(message); void queryClient.invalidateQueries({ queryKey: ["books"] }); }}
          />
          <Snackbar open={Boolean(notice)} autoHideDuration={4500} onClose={() => setNotice("")} message={notice} />
          {showBackToTop && (
            <Tooltip title="回到顶部">
              <Fab
                color="primary"
                size="medium"
                aria-label="回到顶部"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                sx={{
                  position: "fixed",
                  right: { xs: `${tokens.spacing[4]}px`, sm: `${tokens.spacing[6]}px` },
                  bottom: { xs: "calc(76px + env(safe-area-inset-bottom, 0px))", sm: `${tokens.spacing[6]}px` },
                  zIndex: (theme: UiTheme) => theme.zIndex.fab,
                  boxShadow: tokens.shadow.popover,
                }}
              >
                <KeyboardArrowUpRounded />
              </Fab>
            </Tooltip>
          )}
        </>
      }
    />
  );
}
