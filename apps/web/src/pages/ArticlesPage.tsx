import { usePermissions } from "../auth/permissions";
// 文章列表、导入和校对抽屉共享刷新流程，管理动作由角色与服务端共同约束。
// Article listing/import/review share refresh flows, with management actions constrained by roles and the server.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CatalogFilters } from "../components/CatalogFilters";
import {
  _AntAlert as Alert,
  Input,
  _AntProgress as Progress,
  _AntSwitch as Switch,
  Tag,
} from "../ui/antd";
import { useConfirmation } from "../ui/confirmations";
import { ActionToolbar, PageContainer, PageHeader } from "../components/PageHeader";
import { CatalogSection } from "../components/CatalogSection";
import { BookCatalogEmptyState } from "../components/BookCatalogEmptyState";
import { BookGridSkeleton } from "../components/BookGridSkeleton";
import { BookCardPresentation } from "../components/BookCardPresentation";
import { articleGridSx } from "../components/bookGrid";
import { Drawer } from "../ui/overlays";
import { Button } from "../ui/buttons";
import { TextField } from "../ui/forms";
import { Box } from "../ui/primitives";
import { tokens } from "../theme/tokens";
import { articles, type ArticleSummary, type CaptureProgress, type Draft } from "../features/content/api";
import { RequestErrorPage } from "./HttpErrorPage";
import { ArticleCoverField } from "../features/content/ArticleCoverField";
import { ArticleBodyEditor } from "../features/content/ArticleBodyEditor";
import { readArticleImage } from "../features/content/imageImport";
import { articleHtmlToMarkdown, articleMarkdownToHtml } from "../features/content/article-markdown";
import "../features/content/content.css";
const AddToArticleCollectionDialog = lazy(() => import("../features/article-collections/AddToArticleCollectionDialog").then(module => ({ default: module.AddToArticleCollectionDialog })));
const articleCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const articleTags = (tags: string) => tags.split(/[,，、;；\n]/).map(tag => tag.trim()).filter(Boolean);
const MAX_BATCH_CAPTURE_URLS = 20;
function parseCaptureUrls(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of raw.split(/\s+/)) {
    const value = token.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
function isValidHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
const blank = (): Draft => ({
  title: "",
  author: "",
  sourceUrl: "",
  publishedAt: "",
  visibility: "PRIVATE",
  tags: "",
  html: "",
  coverUrl: "",
});

type ImportItemStatus = "QUEUED" | "FETCHING" | "READY" | "SAVING" | "SAVED" | "ERROR";
interface ImportQueueItem {
  id: string;
  url: string;
  origin: "paste" | "submit" | "manual";
  status: ImportItemStatus;
  progress: CaptureProgress | null;
  draft: Draft | null;
  markdown: string;
  bodyDirty: boolean;
  error: string;
}

function ArticleDraftFields({
  editorKey,
  draft,
  markdown,
  error,
  busy,
  onDraftChange,
  onMarkdownChange,
  onImportCover,
  onRemoveCover,
  onImportBodyImages,
}: {
  editorKey: string;
  draft: Draft;
  markdown: string;
  error: string;
  busy: boolean;
  onDraftChange: (next: Draft) => void;
  onMarkdownChange: (value: string) => void;
  onImportCover: (file: File) => Promise<void>;
  onRemoveCover: () => void;
  onImportBodyImages: (files: File[]) => Promise<string | undefined>;
}) {
  return (
    <div className="bk-content-stack">
      {error && <Alert type="error" title={error} />}
      <TextField
        fullWidth
        disabled={busy}
        label="文章标题"
        aria-label="文章标题"
        placeholder="文章标题"
        maxLength={300}
        value={draft.title}
        onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
      />
      <TextField
        fullWidth
        disabled={busy}
        label="作者"
        aria-label="作者"
        placeholder="作者"
        value={draft.author}
        maxLength={300}
        onChange={(e) => onDraftChange({ ...draft, author: e.target.value })}
      />
      <TextField
        fullWidth
        disabled={busy}
        label="标签"
        aria-label="标签"
        placeholder="用逗号分隔多个标签"
        value={draft.tags}
        maxLength={1000}
        onChange={(e) => onDraftChange({ ...draft, tags: e.target.value })}
      />
      <TextField
        fullWidth
        disabled={busy}
        label="来源链接（可选）"
        aria-label="来源链接"
        placeholder="来源链接（可选）"
        value={draft.sourceUrl}
        onChange={(e) => onDraftChange({ ...draft, sourceUrl: e.target.value })}
      />
      <TextField
        fullWidth
        disabled={busy}
        label="发布时间（可选）"
        aria-label="发布时间"
        placeholder="原文发布时间（可选）"
        value={draft.publishedAt}
        maxLength={100}
        onChange={(e) => onDraftChange({ ...draft, publishedAt: e.target.value })}
      />
      <label>
        允许书库成员阅读{" "}
        <Switch
          disabled={busy}
          checked={draft.visibility === "PUBLIC"}
          onChange={(checked) =>
            onDraftChange({
              ...draft,
              visibility: checked ? "PUBLIC" : "PRIVATE",
            })
          }
        />
      </label>
      <ArticleCoverField
        readOnly={false}
        value={draft.coverUrl}
        disabled={busy}
        onImport={onImportCover}
        onRemove={onRemoveCover}
      />
      <ArticleBodyEditor
        key={editorKey}
        markdown={markdown}
        onChange={onMarkdownChange}
        disabled={busy}
        onImportImages={onImportBodyImages}
      />
    </div>
  );
}

export function ArticlesPage() {
  const modal = useConfirmation();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const refreshCollections = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["article-collections"] }),
        queryClient.invalidateQueries({ queryKey: ["article-collection"] }),
      ]),
    [queryClient],
  );
  const manager = can("articles.edit");
  const [collectionArticle, setCollectionArticle] = useState<ArticleSummary | null>(null);
  const [items, setItems] = useState<ArticleSummary[]>([]),
    [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") ?? "ALL";
  const sort = params.get("sort") ?? "recent";
  const updateFilter = (key: string, value: string, defaultValue: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value === defaultValue) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [pageError, setPageError] = useState("");
  const [listBusy, setListBusy] = useState(false);

  // 已有文章的编辑抽屉状态。
  const [editId, setEditId] = useState<string | undefined>();
  const [editDraft, setEditDraft] = useState<Draft | null>(null);
  const [editMarkdown, setEditMarkdown] = useState("");
  const [editBodyDirty, setEditBodyDirty] = useState(false);
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  // 新建/抓取队列工作台状态。
  const [importOpen, setImportOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [savingQueue, setSavingQueue] = useState(false);

  const importQueueRef = useRef(importQueue);
  importQueueRef.current = importQueue;
  const queueIdRef = useRef(0);
  const fetchingRef = useRef(false);
  const importSessionRef = useRef(0);

  const nextQueueId = () => `import-item-${++queueIdRef.current}`;

  const tags = [...new Set(items.flatMap(item => articleTags(item.tags)))].sort(articleCollator.compare);
  const filteredItems = items.filter(item => tag === "ALL" || (tag === "UNTAGGED" ? articleTags(item.tags).length === 0 : articleTags(item.tags).includes(tag)))
    .sort((a, b) => {
      if (sort === "title") return articleCollator.compare(a.title, b.title);
      if (sort === "author") return articleCollator.compare(a.author, b.author) || articleCollator.compare(a.title, b.title);
      return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
    });
  const load = useCallback(() => {
    setLoading(true);
    return articles
      .list()
      .then(result => { setItems(result); setLoadFailure(null); })
      .catch((e: unknown) => setLoadFailure(e))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const runListAction = async (work: () => Promise<void>) => {
    setListBusy(true);
    setPageError("");
    try {
      await work();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setListBusy(false);
    }
  };

  const prepareBody = async (html: string, sourceUrl: string) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    const needsDownload = Array.from(document.images).some(image =>
      !/^\/api\/v1\/articles\/assets\/[0-9a-f-]{36}$/iu.test(image.getAttribute("src") || ""));
    return needsDownload ? (await articles.prepare(html, sourceUrl)).html : html;
  };

  const importImagesForBody = async (files: File[], currentHtml: string, sourceUrl: string) => {
    const current = new DOMParser().parseFromString(currentHtml, "text/html");
    if (current.images.length + files.length > 40) throw new Error("每篇文章最多支持 40 张正文图片。");
    const images = await Promise.all(files.map(readArticleImage));
    const container = document.createElement("div");
    for (const image of images) {
      const node = document.createElement("img");
      node.src = image.src;
      node.alt = image.alt;
      container.append(node);
    }
    const html = await prepareBody(container.innerHTML, sourceUrl);
    if (new DOMParser().parseFromString(html, "text/html").images.length !== images.length) {
      throw new Error("图片未能导入，请检查图片后重试。");
    }
    return articleHtmlToMarkdown(html);
  };

  const openExistingEdit = (value: Draft, id: string) => {
    setEditError("");
    setEditDraft(value);
    setEditId(id);
    setEditMarkdown(articleHtmlToMarkdown(value.html));
    setEditBodyDirty(false);
  };

  const closeExistingEdit = () => {
    if (editBusy) return;
    setEditDraft(null);
    setEditId(undefined);
    setEditError("");
  };

  const resetImportWorkspace = () => {
    importSessionRef.current += 1;
    fetchingRef.current = false;
    setImportQueue([]);
    setActiveItemId(null);
    setUrl("");
    setCaptureError("");
    setSavingQueue(false);
  };

  const closeImportDrawer = () => {
    if (savingQueue || importQueue.some(item => item.status === "FETCHING")) return;
    setImportOpen(false);
    resetImportWorkspace();
  };

  const enqueueCaptureUrls = (urls: string[], origin: "paste" | "submit") => {
    setCaptureError("");
    const currentQueue = importQueueRef.current;
    const hadQueueBefore = currentQueue.length > 0;
    let nextQueue = [...currentQueue];
    let addedOrRetried = 0;

    for (const entry of urls) {
      const existingIndex = nextQueue.findIndex(item => item.url === entry);
      if (existingIndex >= 0) {
        const existing = nextQueue[existingIndex];
        if (existing.status === "ERROR") {
          nextQueue[existingIndex] = {
            ...existing,
            origin,
            status: "QUEUED",
            progress: null,
            error: "",
          };
          addedOrRetried++;
        }
        continue;
      }
      const unsavedCount = nextQueue.filter(item => item.status !== "SAVED").length;
      if (unsavedCount >= MAX_BATCH_CAPTURE_URLS) {
        setCaptureError(`待导入列表中最多保留 ${MAX_BATCH_CAPTURE_URLS} 篇未保存文章，请先保存或移除部分后再继续添加。`);
        if (addedOrRetried === 0) return;
        break;
      }
      nextQueue = [
        ...nextQueue,
        {
          id: nextQueueId(),
          url: entry,
          origin,
          status: "QUEUED",
          progress: null,
          draft: null,
          markdown: "",
          bodyDirty: false,
          error: "",
        },
      ];
      addedOrRetried++;
    }

    if (addedOrRetried === 0) {
      setCaptureError("该链接已在待导入列表中。");
      return;
    }

    setImportQueue(nextQueue);
    if (origin === "paste" || urls.length > 1 || hadQueueBefore) {
      setUrl("");
    }
  };

  const handleCapturePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedText = event.clipboardData.getData("text");
    const pastedUrls = parseCaptureUrls(pastedText);
    if (pastedUrls.length === 0 || !pastedUrls.every(isValidHttpsUrl)) return;
    const el = event.currentTarget;
    const replacesAll = !url.trim() || (el.selectionStart === 0 && el.selectionEnd === url.length);
    if (!replacesAll) return;
    event.preventDefault();
    enqueueCaptureUrls(pastedUrls, "paste");
  };

  const handleCaptureSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const urls = parseCaptureUrls(url);
    if (urls.length === 0) {
      setCaptureError("请输入至少一个以 https:// 开头的网页链接。");
      return;
    }
    const invalidUrl = urls.find(item => !isValidHttpsUrl(item));
    if (invalidUrl) {
      setCaptureError(`仅支持有效的 HTTPS 链接，请检查：${invalidUrl}`);
      return;
    }
    enqueueCaptureUrls(urls, "submit");
  };

  // 顺序抓取队列中待读取的链接，每次抓取一个并在进度条中反馈当前阶段。
  useEffect(() => {
    if (!importOpen || fetchingRef.current) return;
    const nextIndex = importQueue.findIndex(item => item.status === "QUEUED");
    if (nextIndex < 0) return;
    const next = importQueue[nextIndex];
    const session = importSessionRef.current;
    const itemId = next.id;
    const targetUrl = next.url;
    const origin = next.origin;
    const itemNumber = nextIndex + 1;
    const itemTotal = importQueue.length;

    fetchingRef.current = true;
    setImportQueue(previous =>
      previous.map(item =>
        item.id === itemId
          ? {
              ...item,
              status: "FETCHING",
              error: "",
              progress: {
                stage: "FETCHING_PAGE",
                message: `正在连接并请求网页：${targetUrl}`,
                url: targetUrl,
                itemIndex: itemNumber,
                itemTotal,
                percent: 5,
              },
            }
          : item,
      ),
    );

    void (async () => {
      try {
        const captured = await articles.fetch(targetUrl, (progress) => {
          if (importSessionRef.current !== session) return;
          setImportQueue(previous =>
            previous.map(item => (item.id === itemId ? { ...item, progress } : item)),
          );
        });
        fetchingRef.current = false;
        if (importSessionRef.current !== session) return;
        setImportQueue(previous =>
          previous.map(item =>
            item.id === itemId
              ? {
                  ...item,
                  status: "READY",
                  progress: null,
                  draft: captured,
                  markdown: articleHtmlToMarkdown(captured.html),
                  bodyDirty: false,
                  error: "",
                }
              : item,
          ),
        );
        if (origin === "submit") {
          setUrl(previous => (previous.trim() === targetUrl ? "" : previous));
        }
        setActiveItemId(previous => previous ?? itemId);
      } catch (err) {
        fetchingRef.current = false;
        if (importSessionRef.current !== session) return;
        const message = err instanceof Error ? err.message : "操作失败";
        setImportQueue(previous =>
          previous.map(item =>
            item.id === itemId ? { ...item, status: "ERROR", progress: null, error: message } : item,
          ),
        );
      }
    })();
  }, [importOpen, importQueue]);

  const addManualDraft = () => {
    setCaptureError("");
    const unsavedCount = importQueueRef.current.filter(item => item.status !== "SAVED").length;
    if (unsavedCount >= MAX_BATCH_CAPTURE_URLS) {
      setCaptureError(`待导入列表中最多保留 ${MAX_BATCH_CAPTURE_URLS} 篇未保存文章，请先保存或移除部分后再添加。`);
      return;
    }
    const id = nextQueueId();
    setImportQueue(previous => [
      ...previous,
      {
        id,
        url: "",
        origin: "manual",
        status: "READY",
        progress: null,
        draft: blank(),
        markdown: "",
        bodyDirty: false,
        error: "",
      },
    ]);
    setActiveItemId(id);
  };

  const retryQueueItem = (itemId: string) => {
    setCaptureError("");
    setImportQueue(previous =>
      previous.map(item =>
        item.id === itemId ? { ...item, status: "QUEUED", error: "", progress: null } : item,
      ),
    );
  };

  const removeQueueItem = (itemId: string) => {
    const remaining = importQueueRef.current.filter(item => item.id !== itemId);
    setImportQueue(remaining);
    if (activeItemId === itemId) {
      const nextReady = remaining.find(item => item.status === "READY");
      setActiveItemId(nextReady ? nextReady.id : null);
    }
  };

  const saveSingleExisting = async () => {
    if (!editDraft || !editId) return;
    setEditBusy(true);
    setEditError("");
    try {
      const html = !editBodyDirty ? editDraft.html : await prepareBody(articleMarkdownToHtml(editMarkdown), editDraft.sourceUrl);
      await articles.save({ ...editDraft, html }, editId);
      await refreshCollections();
      setEditDraft(null);
      setEditId(undefined);
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setEditBusy(false);
    }
  };

  const saveQueueItem = async (targetId: string, continueAdding: boolean) => {
    const current = importQueueRef.current.find(item => item.id === targetId);
    if (!current || !current.draft) return;
    setSavingQueue(true);
    setImportQueue(previous =>
      previous.map(item => (item.id === targetId ? { ...item, status: "SAVING", error: "" } : item)),
    );
    try {
      const html = !current.bodyDirty
        ? current.draft.html
        : await prepareBody(articleMarkdownToHtml(current.markdown), current.draft.sourceUrl);
      await articles.save({ ...current.draft, html }, undefined);
      setImportQueue(previous =>
        previous.map(item => (item.id === targetId ? { ...item, status: "SAVED", error: "" } : item)),
      );
      await refreshCollections();
      await load();

      const nextQueue = importQueueRef.current.map(item =>
        item.id === targetId ? { ...item, status: "SAVED" as const, error: "" } : item,
      );
      const nextReady = nextQueue.find(item => item.status === "READY");
      const hasPending = nextQueue.some(item => item.status === "QUEUED" || item.status === "FETCHING" || item.status === "ERROR");
      if (continueAdding) {
        if (nextReady) {
          setActiveItemId(nextReady.id);
        } else if (hasPending) {
          setActiveItemId(null);
        } else {
          resetImportWorkspace();
        }
      } else if (nextReady) {
        setActiveItemId(nextReady.id);
      } else if (hasPending) {
        setActiveItemId(null);
      } else {
        setImportOpen(false);
        resetImportWorkspace();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "操作失败";
      setImportQueue(previous =>
        previous.map(item => (item.id === targetId ? { ...item, status: "READY", error: message } : item)),
      );
    } finally {
      setSavingQueue(false);
    }
  };

  const saveAllReady = async () => {
    const targets = importQueueRef.current.filter(item => item.status === "READY" && item.draft !== null);
    if (targets.length === 0) return;
    setSavingQueue(true);
    const savedIds = new Set<string>();
    const failedMessages = new Map<string, string>();
    let firstFailedId: string | null = null;
    try {
      for (const target of targets) {
        const latest = importQueueRef.current.find(item => item.id === target.id);
        if (!latest || latest.status !== "READY" || !latest.draft) continue;
        setImportQueue(previous =>
          previous.map(item => (item.id === latest.id ? { ...item, status: "SAVING", error: "" } : item)),
        );
        try {
          const html = !latest.bodyDirty
            ? latest.draft.html
            : await prepareBody(articleMarkdownToHtml(latest.markdown), latest.draft.sourceUrl);
          await articles.save({ ...latest.draft, html }, undefined);
          savedIds.add(latest.id);
          setImportQueue(previous =>
            previous.map(item => (item.id === latest.id ? { ...item, status: "SAVED", error: "" } : item)),
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "操作失败";
          firstFailedId ??= latest.id;
          failedMessages.set(latest.id, message);
          setImportQueue(previous =>
            previous.map(item => (item.id === latest.id ? { ...item, status: "READY", error: message } : item)),
          );
        }
      }
      if (savedIds.size > 0) {
        await refreshCollections();
        await load();
      }
      const remaining = importQueueRef.current.map(item => {
        if (savedIds.has(item.id)) return { ...item, status: "SAVED" as const, error: "" };
        const err = failedMessages.get(item.id);
        if (err !== undefined) return { ...item, status: "READY" as const, error: err };
        return item;
      });
      if (firstFailedId) {
        setActiveItemId(firstFailedId);
      } else {
        const nextReady = remaining.find(item => item.status === "READY");
        const hasPending = remaining.some(item => item.status === "QUEUED" || item.status === "FETCHING" || item.status === "ERROR");
        if (nextReady) {
          setActiveItemId(nextReady.id);
        } else if (hasPending) {
          setActiveItemId(null);
        } else {
          setImportOpen(false);
          resetImportWorkspace();
        }
      }
    } finally {
      setSavingQueue(false);
    }
  };

  if (loadFailure !== null) return <RequestErrorPage error={loadFailure} retrying={loading} onRetry={() => { void load(); }} />;

  const editingExisting = editDraft !== null && editId !== undefined;
  const activeIndex = importQueue.findIndex(item => item.id === activeItemId && item.status === "READY" && item.draft !== null);
  const activeItem = activeIndex >= 0 ? importQueue[activeIndex] : null;
  const readyItems = importQueue.filter(item => item.status === "READY" && item.draft !== null);
  const fetchingCount = importQueue.filter(item => item.status === "QUEUED" || item.status === "FETCHING").length;
  const savedCount = importQueue.filter(item => item.status === "SAVED").length;
  const hasFetching = importQueue.some(item => item.status === "FETCHING");
  const drawerBusy = editingExisting ? editBusy : savingQueue;

  return (
    <PageContainer>
      <PageHeader title="文章" />
      <div className="bk-content-stack bk-articles-content">
        {pageError && (
          <Alert
            type="error"
            title={pageError}
            closable
            onClose={() => setPageError("")}
          />
        )}
        <CatalogSection
          title="全部文章"
          tools={
            <CatalogFilters
              actions={
                manager ? (
                  <Button
                    variant="contained"
                    disabled={listBusy}
                    onClick={() => {
                      setPageError("");
                      setCaptureError("");
                      setImportOpen(true);
                    }}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    添加文章
                  </Button>
                ) : undefined
              }
              filter={{ label: "标签", value: tag, onChange: value => updateFilter("tag", value, "ALL"), options: [
                { value: "ALL", label: "全部标签" }, { value: "UNTAGGED", label: "无标签" },
                ...tags.map(value => ({ value, label: value })),
              ] }}
              sort={{ label: "排序", value: sort, onChange: value => updateFilter("sort", value, "recent"), options: [
                { value: "recent", label: "最近添加" }, { value: "title", label: "按标题" }, { value: "author", label: "按作者" },
              ] }}
            />
          }
        >
          {loading ? (
            <BookGridSkeleton label="正在加载文章" variant="article" count={6} />
          ) : filteredItems.length === 0 ? (
            <BookCatalogEmptyState
              title={tag !== "ALL" ? "没有找到匹配的文章" : "还没有文章"}
              action={tag !== "ALL" ? <Button onClick={() => updateFilter("tag", "ALL", "ALL")}>清除筛选</Button> : undefined}
            />
          ) : (
            <Box component="section" aria-label="文章列表" sx={articleGridSx}>
              {filteredItems.map((article) => (
                <BookCardPresentation
                  key={article.id}
                  variant="article"
                  href={`/articles/${article.id}`}
                  book={{
                    id: article.id,
                    title: article.title,
                    author: article.author,
                    coverUrl: article.cover_url || undefined,
                  }}
                  status={article.visibility === "PUBLIC" ? "书库成员可见" : "私密文章"}
                  actions={[
                    ...(can("articles.collections.edit") ? [{ label: "加入合集", onClick: () => setCollectionArticle(article) }] : []),
                    ...(manager ? [
                    {
                      label: "编辑文章",
                      onClick: () => void runListAction(async () => {
                        const a = await articles.get(article.id);
                        openExistingEdit({ title: a.title, author: a.author, sourceUrl: a.source_url, publishedAt: a.published_at, visibility: a.visibility, tags: a.tags, html: a.html, coverUrl: a.cover_url || "" }, a.id);
                      }),
                    },
                    {
                      label: "删除文章",
                      danger: true,
                      onClick: () => modal.confirm({
                        title: "删除这篇文章？",
                        content: "文章阅读记录及笔记也会删除。",
                        okText: "删除",
                        cancelText: "取消",
                        okButtonProps: { danger: true },
                        onOk: () => runListAction(async () => { await articles.remove(article.id); await refreshCollections(); await load(); }),
                      }),
                    },
                    ] : []),
                  ]}
                />
              ))}
            </Box>
          )}
        </CatalogSection>
      </div>
      <Drawer
        anchor="right"
        slotProps={{ paper: { sx: { width: `min(100vw, ${tokens.layout.touchTarget * 16}px)` } } }}
        title={editingExisting ? "编辑文章" : activeItem ? "导入文章" : "添加文章"}
        open={importOpen || editingExisting}
        destroyOnHidden
        onClose={editingExisting ? closeExistingEdit : closeImportDrawer}
        footer={
          editingExisting ? (
            <ActionToolbar>
              <Button
                variant="contained"
                aria-label="保存"
                loading={editBusy}
                onClick={() => void saveSingleExisting()}
              >
                保存
              </Button>
            </ActionToolbar>
          ) : (
            <ActionToolbar>
              <Button onClick={addManualDraft} disabled={savingQueue}>手动导入</Button>
              {activeItem ? (
                <>
                  {readyItems.length >= 2 && (
                    <Button disabled={savingQueue} onClick={() => void saveAllReady()}>
                      保存全部（{readyItems.length} 篇）
                    </Button>
                  )}
                  <Button disabled={savingQueue} onClick={() => void saveQueueItem(activeItem.id, true)}>
                    保存并继续添加
                  </Button>
                  <Button
                    variant="contained"
                    aria-label="保存"
                    loading={savingQueue}
                    onClick={() => void saveQueueItem(activeItem.id, false)}
                  >
                    保存
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={closeImportDrawer} disabled={savingQueue || hasFetching}>
                    {savedCount > 0 ? "完成" : "取消"}
                  </Button>
                  <Button
                    type="submit"
                    form="article-capture-form"
                    variant="contained"
                    loading={hasFetching && importQueue.length === 1}
                  >
                    读取网页并预览
                  </Button>
                </>
              )}
            </ActionToolbar>
          )
        }
      >
        {editingExisting && editDraft ? (
          <div className="bk-article-editor-form">
            <ArticleDraftFields
              editorKey={editId!}
              draft={editDraft}
              markdown={editMarkdown}
              error={editError}
              busy={editBusy}
              onDraftChange={setEditDraft}
              onMarkdownChange={(value) => {
                setEditMarkdown(value);
                setEditBodyDirty(true);
              }}
              onImportCover={async (file) => {
                setEditBusy(true);
                setEditError("");
                try {
                  const image = await readArticleImage(file);
                  setEditDraft(previous => (previous ? { ...previous, coverUrl: image.src } : previous));
                } catch (e) {
                  setEditError(e instanceof Error ? e.message : "操作失败");
                } finally {
                  setEditBusy(false);
                }
              }}
              onRemoveCover={() => setEditDraft(previous => (previous ? { ...previous, coverUrl: "" } : previous))}
              onImportBodyImages={async (files) => {
                setEditBusy(true);
                setEditError("");
                try {
                  return await importImagesForBody(
                    files,
                    editBodyDirty ? articleMarkdownToHtml(editMarkdown) : editDraft.html,
                    editDraft.sourceUrl,
                  );
                } catch (e) {
                  setEditError(e instanceof Error ? e.message : "操作失败");
                  return undefined;
                } finally {
                  setEditBusy(false);
                }
              }}
            />
          </div>
        ) : (
          <div className="bk-article-editor-form bk-content-stack">
            <form
              id="article-capture-form"
              className="bk-article-capture-bar"
              onSubmit={handleCaptureSubmit}
            >
              {captureError && <Alert type="error" title={captureError} />}
              <label htmlFor="article-capture-url">网页链接</label>
              <div className="bk-article-capture-input-row">
                <Input
                  id="article-capture-url"
                  autoFocus
                  placeholder="粘贴微信公众号文章或其他公开网页链接（HTTPS），粘贴后自动识别"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onPaste={handleCapturePaste}
                />
                <Button type="submit">识别链接</Button>
              </div>
              <p className="bk-article-capture-hint">
                粘贴单个链接后自动加入识别队列，可连续粘贴多个；读取完成后点击列表中的任意文章即可切换编辑。
              </p>
            </form>

            {importQueue.length > 0 && (
              <section className="bk-import-queue-section" aria-label="待导入队列">
                <div className="bk-import-queue-head">
                  <h3 className="bk-import-queue-title">待导入文章（共 {importQueue.length} 篇）</h3>
                  <span className="bk-import-queue-summary">
                    待保存 {readyItems.length} · 读取中 {fetchingCount} · 已保存 {savedCount}
                  </span>
                </div>
                <ul className="bk-import-queue" aria-label="待导入文章列表">
                  {importQueue.map((item, index) => {
                    const isActive = activeItem?.id === item.id;
                    const displayTitle = item.draft?.title.trim() || item.progress?.title?.trim() || item.url || "未命名文章";
                    return (
                      <li
                        key={item.id}
                        className="bk-import-queue-item"
                        data-active={isActive ? "true" : "false"}
                      >
                        <div className="bk-import-queue-item-head">
                          {item.status === "READY" ? (
                            <button
                              type="button"
                              className="bk-import-queue-select"
                              aria-pressed={isActive}
                              onClick={() => setActiveItemId(item.id)}
                            >
                              <span className="bk-article-batch-item-title">
                                #{index + 1} {displayTitle}
                              </span>
                              {item.url && <span className="bk-article-batch-item-meta">{item.url}</span>}
                            </button>
                          ) : (
                            <div className="bk-import-queue-static">
                              <span className="bk-article-batch-item-title">
                                #{index + 1} {displayTitle}
                              </span>
                              {item.url && item.url !== displayTitle && (
                                <span className="bk-article-batch-item-meta">{item.url}</span>
                              )}
                            </div>
                          )}
                          <div className="bk-import-queue-actions">
                            {item.status === "QUEUED" && <Tag>等待读取</Tag>}
                            {item.status === "FETCHING" && (
                              <Tag color="processing">
                                读取中 {Math.max(0, Math.min(100, Math.round(item.progress?.percent ?? 0)))}%
                              </Tag>
                            )}
                            {item.status === "READY" && (
                              <Tag color={isActive ? "blue" : "default"}>
                                {isActive ? "正在编辑" : "点击编辑"}
                              </Tag>
                            )}
                            {item.status === "SAVING" && <Tag color="processing">保存中</Tag>}
                            {item.status === "SAVED" && <Tag color="success">已保存</Tag>}
                            {item.status === "ERROR" && <Tag color="error">读取失败</Tag>}
                            {item.status === "ERROR" && (
                              <Button size="small" onClick={() => retryQueueItem(item.id)}>
                                重试
                              </Button>
                            )}
                            {item.status !== "FETCHING" && item.status !== "SAVING" && (
                              <Button size="small" onClick={() => removeQueueItem(item.id)}>
                                移除
                              </Button>
                            )}
                          </div>
                        </div>
                        {item.status === "FETCHING" && item.progress && (
                          <div className="bk-article-capture-progress" role="status" aria-label="抓取进度">
                            <div className="bk-article-capture-progress-head">
                              <span>
                                {(item.progress.itemTotal ?? 1) > 1
                                  ? `正在处理第 ${item.progress.itemIndex ?? index + 1} / ${item.progress.itemTotal} 篇`
                                  : "正在抓取网页"}
                              </span>
                              <span>{Math.max(0, Math.min(100, Math.round(item.progress.percent)))}%</span>
                            </div>
                            <Progress
                              percent={Math.max(0, Math.min(100, Math.round(item.progress.percent)))}
                              size="small"
                              status="active"
                              showInfo={false}
                            />
                            <p className="bk-article-capture-progress-message">{item.progress.message}</p>
                            <ul className="bk-article-capture-details">
                              {item.progress.url && <li>当前请求：{item.progress.url}</li>}
                              {item.progress.title && (
                                <li>
                                  已读取标题：《{item.progress.title}》
                                  {item.progress.author ? `（${item.progress.author}）` : ""}
                                </li>
                              )}
                              {Boolean(item.progress.imageTotal && item.progress.imageTotal > 0) && (
                                <li>
                                  正文图片：{item.progress.imageIndex ?? 0} / {item.progress.imageTotal}
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                        {item.status === "ERROR" && item.error && (
                          <Alert type="error" title={item.error} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {activeItem && activeItem.draft && (
              <section className="bk-import-editor-section bk-content-stack" aria-label="当前编辑文章">
                {importQueue.length > 1 && (
                  <h3 className="bk-import-editor-heading">
                    正在编辑第 {activeIndex + 1} 篇：{activeItem.draft.title.trim() || "未命名文章"}
                  </h3>
                )}
                <ArticleDraftFields
                  editorKey={activeItem.id}
                  draft={activeItem.draft}
                  markdown={activeItem.markdown}
                  error={activeItem.error}
                  busy={drawerBusy}
                  onDraftChange={(nextDraft) =>
                    setImportQueue(previous =>
                      previous.map(item => (item.id === activeItem.id ? { ...item, draft: nextDraft } : item)),
                    )
                  }
                  onMarkdownChange={(value) =>
                    setImportQueue(previous =>
                      previous.map(item =>
                        item.id === activeItem.id ? { ...item, markdown: value, bodyDirty: true } : item,
                      ),
                    )
                  }
                  onImportCover={async (file) => {
                    const targetId = activeItem.id;
                    setSavingQueue(true);
                    setImportQueue(previous =>
                      previous.map(item => (item.id === targetId ? { ...item, error: "" } : item)),
                    );
                    try {
                      const image = await readArticleImage(file);
                      setImportQueue(previous =>
                        previous.map(item =>
                          item.id === targetId && item.draft
                            ? { ...item, draft: { ...item.draft, coverUrl: image.src } }
                            : item,
                        ),
                      );
                    } catch (e) {
                      const message = e instanceof Error ? e.message : "操作失败";
                      setImportQueue(previous =>
                        previous.map(item => (item.id === targetId ? { ...item, error: message } : item)),
                      );
                    } finally {
                      setSavingQueue(false);
                    }
                  }}
                  onRemoveCover={() =>
                    setImportQueue(previous =>
                      previous.map(item =>
                        item.id === activeItem.id && item.draft
                          ? { ...item, draft: { ...item.draft, coverUrl: "" } }
                          : item,
                      ),
                    )
                  }
                  onImportBodyImages={async (files) => {
                    const targetId = activeItem.id;
                    const currentHtml = activeItem.bodyDirty
                      ? articleMarkdownToHtml(activeItem.markdown)
                      : activeItem.draft!.html;
                    const sourceUrl = activeItem.draft!.sourceUrl;
                    setSavingQueue(true);
                    setImportQueue(previous =>
                      previous.map(item => (item.id === targetId ? { ...item, error: "" } : item)),
                    );
                    try {
                      return await importImagesForBody(files, currentHtml, sourceUrl);
                    } catch (e) {
                      const message = e instanceof Error ? e.message : "操作失败";
                      setImportQueue(previous =>
                        previous.map(item => (item.id === targetId ? { ...item, error: message } : item)),
                      );
                      return undefined;
                    } finally {
                      setSavingQueue(false);
                    }
                  }}
                />
              </section>
            )}
          </div>
        )}
      </Drawer>
      {collectionArticle && <Suspense fallback={null}><AddToArticleCollectionDialog open articleId={collectionArticle.id} articleTitle={collectionArticle.title} articleVisibility={collectionArticle.visibility} onClose={() => setCollectionArticle(null)} /></Suspense>}
    </PageContainer>
  );
}
