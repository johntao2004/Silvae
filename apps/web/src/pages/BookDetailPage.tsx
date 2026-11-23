import { AppLoading } from "../components/AppLoading";
import { RequestErrorPage } from "./HttpErrorPage";
import { usePermissions } from "../auth/permissions";
import { BookReviewsPanel } from "../features/reviews/BookReviewsPanel";
import { BookMetadataLayout, bookDetailMetadataFieldsSx, bookMetadataTitleSx } from "../components/BookMetadataLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiRequestError } from "../api/client";
import { RequireAuth, useAuth } from "../auth/AuthContext";
import { AddToBooklistDialog } from "../components/AddToBooklistDialog";
import { FileOperationDialog } from "../components/FileOperationDialog";
import { PageBackAction, PageContainer, PageHeader } from "../components/PageHeader";
import type { BookFormat, BookMetadata } from "../domain/types";
import { tokens } from "../theme/tokens";
import { Skeleton } from "../ui/antd";
import { Button } from "../ui/buttons";
import { Alert, Chip, Divider } from "../ui/feedback";
import { Box, Snackbar, Stack, Typography, type UiTheme } from "../ui/primitives";
import { useFeedback } from "../ui/notifications";
import { themaPath } from "../domain/thema";
import { formatLanguages } from "../domain/languages";
import { formatPublicationDate } from "../domain/publication-date";

function resolveBookReturnTo(state: unknown, fallback: string): string {
  if (!state || typeof state !== "object" || !("bookReturnTo" in state)) return fallback;
  const candidate = (state as { bookReturnTo?: unknown }).bookReturnTo;
  return typeof candidate === "string" && /^\/library(?:\/all)?(?:[?#]|$)/.test(candidate) ? candidate : fallback;
}

// 公开与成员书籍详情共用同一详情主体视图；编辑统一跳转到独立元信息编辑路由。
// Public and member book details share one detail body; metadata editing routes to the dedicated edit page.
export function BookDetailPage() {
  const { user, ready } = useAuth();
  if (!ready) return <AppLoading label="正在确认登录状态…" />;
  return user ? <RequireAuth><MemberBookDetailPage /></RequireAuth> : <PublicBookDetailPage />;
}

function PublicBookDetailPage() {
  const { bookId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = resolveBookReturnTo(location.state, "/library");
  const query = useQuery({ queryKey: ["display-book", bookId], queryFn: () => api.getDisplayBook(bookId) });
  const book = query.data;
  const metadataQuery = useQuery({ queryKey: ["display-book-metadata", bookId], queryFn: () => api.getDisplayBookMetadata(bookId), enabled: Boolean(book) });
  const metadata = metadataQuery.data;
  const sourceQuery = useQuery({
    queryKey: ["display-book-bibliography-source", bookId],
    queryFn: ({ signal }) => api.getDisplayBookBibliographySource(bookId, signal),
    enabled: Boolean(metadata && book?.available && ((!metadata.description && metadata.sources.description !== "MANUAL") || (!metadata.authorBiography && metadata.sources.authorBiography !== "MANUAL"))),
    retry: false,
    staleTime: 300000,
  });
  const title = metadata?.title || book?.title || "";
  const author = metadata?.authors.join(" / ") || book?.author;
  const description = metadata ? metadata.description || (metadata.sources.description === "MANUAL" ? undefined : sourceQuery.data?.description) : book?.description;
  const biography = metadata?.authorBiography || (metadata?.sources.authorBiography === "MANUAL" ? undefined : sourceQuery.data?.authorBiography);

  return (
    <BookDetailBody
      onBack={() => navigate(returnTo)}
      bookPending={query.isPending}
      bookError={query.isError && !book ? query.error : null}
      bookFetching={query.isFetching}
      onRetryBook={() => void query.refetch()}
      hasBook={Boolean(book)}
      coverUrl={metadata?.coverUrl || book?.coverUrl}
      format={book?.format}
      title={title}
      subtitle={metadata?.subtitle}
      author={author}
      available={Boolean(book?.available)}
      actions={<Button variant="contained" disabled={!book?.available} onClick={() => book && navigate(`/reader/${book.id}`)}>开始阅读</Button>}
      metadataPending={metadataQuery.isPending}
      metadataError={metadataQuery.isError}
      metadataFetching={metadataQuery.isFetching}
      onRetryMetadata={() => void metadataQuery.refetch()}
      displayedMetadata={metadata ? { ...metadata, publiclyVisible: true } : undefined}
      knowledgeSection={Boolean(metadata?.knowledgeTerms?.length) && (
        <Box component="section" aria-label="知识点">
          <Typography variant="caption" color="text.muted">知识点</Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: `${tokens.spacing[2]}px` }}>
            {metadata?.knowledgeTerms?.map(term => <Chip key={term} label={term} sx={{ maxWidth: "100%" }} />)}
          </Stack>
        </Box>
      )}
      sourceError={sourceQuery.isError ? sourceQuery.error : null}
      sourceFetching={sourceQuery.isFetching}
      onRetrySource={() => void sourceQuery.refetch()}
      description={description}
      authorBiography={biography}
    />
  );
}

function MemberBookDetailPage() {
  const { bookId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [fileOperation, setFileOperation] = useState<"RENAME" | "TRASH" | null>(null);
  const feedback = useFeedback();
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["book", bookId, user?.id], queryFn: () => api.getBook(bookId) });
  const metadataQuery = useQuery({ queryKey: ["book-metadata", bookId], queryFn: () => api.getBookMetadata(bookId) });
  const returnTo = resolveBookReturnTo(location.state, "/library/all");
  const { can } = usePermissions();
  const book = query.data;
  const metadata = metadataQuery.data;
  const title = metadata?.title || book?.title || "";
  const author = metadata?.authors.join(" / ") || book?.author;
  const sourceQuery = useQuery({
    queryKey: ["book-bibliography-source", bookId],
    queryFn: ({ signal }) => api.getBookBibliographySource(bookId, signal),
    enabled: Boolean(metadata && book?.status === "AVAILABLE" && !metadata.authorBiography && metadata.sources.authorBiography !== "MANUAL"),
    retry: false,
    staleTime: 300000,
  });
  const knowledgeQuery = useQuery({
    queryKey: ["book-knowledge-draft", bookId],
    queryFn: ({ signal }) => api.getBookKnowledge(bookId, signal),
    enabled: Boolean(book) && can("knowledge.view"),
    retry: false,
  });
  const description = metadata ? metadata.description : book?.description;
  const authorBiography = metadata?.authorBiography || (metadata?.sources.authorBiography === "MANUAL" ? undefined : sourceQuery.data?.authorBiography);

  return (
    <BookDetailBody
      onBack={() => navigate(returnTo)}
      bookPending={query.isPending}
      bookError={query.isError && !query.data ? query.error : null}
      bookFetching={query.isFetching}
      onRetryBook={() => void query.refetch()}
      hasBook={Boolean(!query.isError && book)}
      coverUrl={metadata?.coverUrl || book?.coverUrl}
      format={book?.format}
      title={title}
      subtitle={metadata?.subtitle}
      author={author}
      available={book?.status === "AVAILABLE"}
      actions={book && (
        <>
          <Button variant="contained" disabled={!can("reader.read") || book.status !== "AVAILABLE"} onClick={() => navigate(`/reader/${book.id}`)}>
            {book.progress > 0 ? "继续阅读" : "开始阅读"}
          </Button>
          {can("library.download") && book.status === "AVAILABLE" && (
            <Button component="a" variant="outlined" href={`/api/v1/books/${encodeURIComponent(book.id)}/download`} download={`${title}.${book.format.toLowerCase()}`}>
              下载原书
            </Button>
          )}
          <Button variant="outlined" disabled={!can("booklists.edit") || book.status !== "AVAILABLE"} onClick={() => setAdding(true)}>
            加入书单
          </Button>
          {can("library.edit") && (
            <Button
              variant="outlined"
              onClick={() => navigate(`/library/books/${encodeURIComponent(book.id)}/edit`, {
                state: { bookDetailReturnTo: `/library/books/${book.id}`, bookReturnTo: returnTo },
              })}
            >
              编辑元信息
            </Button>
          )}
          {!can("library.edit") && can("library.files") && (
            <Button variant="outlined" onClick={() => setFileOperation("RENAME")}>重命名原文件</Button>
          )}
          {can("library.trash") && (
            <Button variant="outlined" color="error" disabled={book.status === "TRASHED"} onClick={() => setFileOperation("TRASH")}>
              删除书籍
            </Button>
          )}
        </>
      )}
      metadataPending={metadataQuery.isPending}
      metadataError={metadataQuery.isError}
      metadataFetching={metadataQuery.isFetching}
      onRetryMetadata={() => void metadataQuery.refetch()}
      displayedMetadata={metadata}
      knowledgeSection={can("knowledge.view") && (
        <Box component="section" aria-label="知识点">
          <Typography variant="caption" color="text.muted">知识点</Typography>
          {knowledgeQuery.isPending ? <Typography role="status" variant="caption">正在读取知识点…</Typography>
            : knowledgeQuery.isError ? <Alert severity="error" action={<Button onClick={() => void knowledgeQuery.refetch()}>重试知识点</Button>}>知识点暂时无法读取。</Alert>
            : (metadata?.knowledgeTerms?.length || knowledgeQuery.data?.points.length) ? (
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: `${tokens.spacing[2]}px` }}>
                {[...new Map([...(metadata?.knowledgeTerms ?? []), ...(knowledgeQuery.data?.points ?? []).map(point => point.name)].map(name => [name.normalize("NFKC").trim().toLocaleLowerCase(), name])).values()].map(name => <Chip key={name} label={name} />)}
              </Stack>
            ) : <Typography color="text.muted">—</Typography>}
        </Box>
      )}
      sourceError={sourceQuery.isError ? sourceQuery.error : null}
      sourceFetching={sourceQuery.isFetching}
      onRetrySource={() => void sourceQuery.refetch()}
      description={description}
      authorBiography={authorBiography}
      afterLayout={book && (
        <>
          <BookReviewsPanel key={`${book.id}:${user?.id}`} bookId={book.id} bookTitle={book.title} />
          <AddToBooklistDialog open={adding} bookId={book.id} bookTitle={book.title} onClose={() => setAdding(false)} onCompleted={message => { setAdding(false); setNotice(message); }} />
          {(can("library.files") || can("library.trash")) && (
            <FileOperationDialog
              book={fileOperation ? book : null}
              type={fileOperation}
              onClose={() => setFileOperation(null)}
              onCompleted={result => {
                void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
                void queryClient.invalidateQueries({ queryKey: ["books"] });
                void queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
                void queryClient.invalidateQueries({ queryKey: ["display-books"] });
                void queryClient.invalidateQueries({ queryKey: ["file-task-history"] });
                if (result.type === "TRASH" && ["SUCCEEDED", "PLANNED", "RUNNING"].includes(result.status)) {
                  const message = result.status === "SUCCEEDED" ? "书籍已移入回收站" : "删除任务已提交，可在「文件操作记录」中查看进度";
                  feedback?.[result.status === "SUCCEEDED" ? "success" : "info"]({ title: message });
                  navigate(returnTo, { replace: true });
                } else {
                  setNotice(result.status === "SUCCEEDED" ? "文件任务已完成" : "文件任务已提交");
                }
              }}
            />
          )}
        </>
      )}
      footer={<Snackbar open={Boolean(notice)} message={notice} autoHideDuration={4500} onClose={() => setNotice("")} />}
    />
  );
}

interface BookDetailBodyProps {
  onBack: () => void;
  bookPending: boolean;
  bookError: Error | null;
  bookFetching: boolean;
  onRetryBook: () => void;
  hasBook: boolean;
  coverUrl?: string;
  format?: BookFormat;
  title: string;
  subtitle?: string;
  author?: string;
  available: boolean;
  actions: ReactNode;
  metadataPending: boolean;
  metadataError: boolean;
  metadataFetching: boolean;
  onRetryMetadata: () => void;
  displayedMetadata?: BookMetadata;
  knowledgeSection?: ReactNode;
  sourceError: Error | null;
  sourceFetching: boolean;
  onRetrySource: () => void;
  description?: string;
  authorBiography?: string;
  afterLayout?: ReactNode;
  footer?: ReactNode;
}

function BookDetailBody({
  onBack,
  bookPending,
  bookError,
  bookFetching,
  onRetryBook,
  hasBook,
  coverUrl,
  format,
  title,
  subtitle,
  author,
  available,
  actions,
  metadataPending,
  metadataError,
  metadataFetching,
  onRetryMetadata,
  displayedMetadata,
  knowledgeSection,
  sourceError,
  sourceFetching,
  onRetrySource,
  description,
  authorBiography,
  afterLayout,
  footer,
}: BookDetailBodyProps) {
  if (bookError) {
    return <RequestErrorPage error={bookError} retrying={bookFetching} onRetry={onRetryBook} back={<PageBackAction onClick={onBack}>返回书库</PageBackAction>} />;
  }
  return (
    <PageContainer>
      <PageHeader back={<PageBackAction inline onClick={onBack}>返回书库</PageBackAction>} eyebrow="BOOK DETAILS" title="书籍详情" />
      {bookPending ? (
        <div role="status" aria-label="正在加载书籍详情"><Skeleton active paragraph={{ rows: 8 }} /></div>
      ) : !hasBook ? (
        <Stack spacing={2}>
          <Alert severity="error">无法加载书籍信息，书籍可能已移除或暂时无法访问。</Alert>
          <Button variant="outlined" onClick={onRetryBook}>重试</Button>
        </Stack>
      ) : (
        <>
          <BookMetadataLayout coverUrl={coverUrl} coverAlt={`${title}封面`}>
            {format && (
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: `${tokens.spacing[2]}px`, justifyContent: { xs: "center", sm: "flex-start" } }}>
                <Chip label={format} variant="outlined" size="small" sx={{ maxWidth: "100%" }} />
              </Stack>
            )}
            <Box sx={{ minWidth: 0, textAlign: { xs: "center", sm: "left" } }}>
              <Typography variant="h2" component="h2" sx={bookMetadataTitleSx}>{title}</Typography>
              {subtitle && <Typography sx={{ mt: `${tokens.spacing[2]}px`, overflowWrap: "anywhere" }}>{subtitle}</Typography>}
              <Typography color="text.secondary" sx={{ mt: `${tokens.spacing[2]}px`, overflowWrap: "anywhere" }}>{author}</Typography>
            </Box>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: `${tokens.spacing[3]}px`, justifyContent: { xs: "center", sm: "flex-start" } }}>
              {actions}
            </Stack>
            {!available && <Alert severity="warning">这本书暂时无法阅读。</Alert>}
            <Divider />
            <Box component="section" aria-labelledby="book-bibliography-title">
              <Typography id="book-bibliography-title" variant="h5" component="h3" sx={{ mb: `${tokens.spacing[4]}px` }}>书目资料</Typography>
              {metadataPending ? (
                <div role="status" aria-label="正在加载元数据"><Skeleton active paragraph={{ rows: 5 }} /></div>
              ) : metadataError || !displayedMetadata ? (
                <Stack role="alert" spacing={2} sx={{ alignItems: "flex-start" }}>
                  <Typography color="error.main">书目资料暂时无法加载。</Typography>
                  <Button variant="outlined" disabled={metadataFetching} onClick={onRetryMetadata}>重试元数据</Button>
                </Stack>
              ) : (
                <MetadataFields metadata={displayedMetadata} />
              )}
            </Box>
            {knowledgeSection}
            {sourceError && <BibliographySourceError error={sourceError} retrying={sourceFetching} onRetry={onRetrySource} />}
            <Box component="section" aria-labelledby="book-description-title">
              <Typography id="book-description-title" variant="h5" component="h3" sx={{ mb: `${tokens.spacing[3]}px` }}>内容简介</Typography>
              <Typography color={description ? "text.primary" : "text.muted"} sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{description || "—"}</Typography>
            </Box>
            <Box component="section" aria-label="作者介绍">
              <Typography variant="h5" component="h3" sx={{ mb: `${tokens.spacing[3]}px` }}>作者介绍</Typography>
              <Typography color={authorBiography ? "text.primary" : "text.muted"} sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{authorBiography || "—"}</Typography>
            </Box>
          </BookMetadataLayout>
          {afterLayout}
        </>
      )}
      {footer}
    </PageContainer>
  );
}

function BibliographySourceError({ error, retrying, onRetry }: { error: Error; retrying: boolean; onRetry: () => void }) {
  if (error instanceof ApiRequestError && error.code === "BIBLIOGRAPHY_PDF_ENCRYPTED") {
    return null;
  }
  return <Alert severity="warning" action={<Button disabled={retrying} onClick={onRetry}>重试原书信息</Button>}>
    {error.message || "无法读取原书补充资料，请稍后重试。"}
  </Alert>;
}

function MetadataFields({ metadata }: { metadata: BookMetadata }) {
  const subjects = metadata.subjectCodes ?? [];
  return <DetailFields fields={[
    ["译者", metadata.translators.join(" / ")],
    ["出版社", metadata.publisher],
    ["出版日期", formatPublicationDate(metadata.publishedDate)], ["ISBN", metadata.isbn],
    ["语言", formatLanguages(metadata.language)], ["系列", metadata.series], ["系列序号", metadata.seriesIndex?.toString()],
    ["公开展示", metadata.publiclyVisible === undefined ? undefined : metadata.publiclyVisible ? "已公开" : "仅书库内可见"],
    ["标签", metadata.tags.join("、")], ["学科分类", subjects.length ? <Stack spacing={1} sx={(theme: UiTheme) => ({ "& a": { color: theme.palette.mode === "dark" ? theme.palette.primary.main : theme.palette.primary.dark } })}>{subjects.map(code => <Link key={code} to={`/library?advanced=1&subject=${encodeURIComponent(code)}`}>{themaPath(code)}</Link>)}</Stack> : undefined],
  ]} />;
}

function DetailFields({ fields }: { fields: [string, ReactNode][] }) {
  return <Box component="dl" sx={{ ...bookDetailMetadataFieldsSx, m: 0 }}>
    {fields.map(([label, value]) => <Box
      key={label}
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "84px minmax(0, 1fr)", sm: "76px minmax(0, 1fr)" },
        columnGap: 1.5,
        alignItems: "baseline",
        minWidth: 0,
      }}
    >
      <Typography component="dt" variant="caption" color="text.muted" sx={{ lineHeight: 1.5 }}>{label}</Typography>
      <Typography component="dd" color={value ? "text.primary" : "text.muted"} sx={{ m: 0, lineHeight: 1.5, overflowWrap: "anywhere" }}>{value || "—"}</Typography>
    </Box>)}
  </Box>;
}
