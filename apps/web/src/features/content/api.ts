// 文章阅读状态按最后提交生效；revision 保留兼容旧客户端，不再作为并发写入锁。
// Article reading state is last-write-wins; revision is retained for wire compatibility, not conflict detection.
import { request, streamNdjson } from "../../api/client";
import { createApiRequestError } from "../../api/errors";
import type { AnnotationColor, AnnotationStyle } from "../../domain/types";
export interface ArticleSummary {
  id: string;
  title: string;
  author: string;
  source_url: string;
  published_at: string;
  visibility: "PUBLIC" | "PRIVATE";
  tags: string;
  cover_url?: string | null;
  excerpt?: string;
  created_at: string;
  updated_at: string;
}
export interface Article extends ArticleSummary {
  html: string;
}
export interface Draft {
  title: string;
  author: string;
  sourceUrl: string;
  publishedAt: string;
  visibility: "PUBLIC" | "PRIVATE";
  tags: string;
  html: string;
  coverUrl?: string;
}
export type BatchImportStatus = "IMPORTED" | "DUPLICATE" | "FAILED";
export interface BatchImportItem {
  url: string;
  status: BatchImportStatus;
  id?: string | null;
  title?: string | null;
  message?: string | null;
}
export interface BatchImportResult {
  imported: number;
  duplicate: number;
  failed: number;
  items: BatchImportItem[];
}
export interface CaptureProgress {
  stage: string;
  message: string;
  url?: string | null;
  title?: string | null;
  author?: string | null;
  itemIndex?: number | null;
  itemTotal?: number | null;
  imageIndex?: number | null;
  imageTotal?: number | null;
  percent: number;
  items?: BatchImportItem[];
}
interface ArticleStreamEvent {
  type: "progress" | "item" | "result" | "error";
  stage?: string | null;
  message?: string | null;
  url?: string | null;
  title?: string | null;
  author?: string | null;
  itemIndex?: number | null;
  itemTotal?: number | null;
  imageIndex?: number | null;
  imageTotal?: number | null;
  percent?: number | null;
  item?: BatchImportItem | null;
  draft?: Draft | null;
  batchResult?: BatchImportResult | null;
  status?: number | null;
  code?: string | null;
}
export interface ReadingState {
  locator: string;
  progress: number;
  seconds: number;
  annotations: Entry[];
}
export interface Entry {
  id: string;
  type: "NOTE" | "HIGHLIGHT" | "BOOKMARK";
  quote: string;
  note: string;
  locator: string;
  createdAt: string;
  style?: AnnotationStyle;
  color?: AnnotationColor;
}
export const emptyReading = (): ReadingState => ({
  locator: "",
  progress: 0,
  seconds: 0,
  annotations: [],
});
export const articles = {
  list: () => request<ArticleSummary[]>("/articles"),
  get: (id: string) => request<Article>(`/articles/${id}`),
  fetch: async (url: string, onProgress?: (progress: CaptureProgress) => void) => {
    let captured: Draft | undefined;
    await streamNdjson<ArticleStreamEvent>(
      "/articles/fetch-stream",
      { method: "POST", body: JSON.stringify({ url }) },
      (event) => {
        if (event.type === "error") {
          const status = event.status ?? 400;
          const code = event.code ?? "FETCH_FAILED";
          throw createApiRequestError(status, {
            code,
            detail: event.message ?? "抓取失败，请稍后重试或手动导入。",
            type: `urn:humite:error:${code.toLowerCase()}`,
          });
        }
        if (event.type === "result" && event.draft) {
          captured = event.draft;
          onProgress?.({
            stage: event.stage ?? "DONE",
            message: event.message ?? "读取完成，正在打开预览…",
            url: event.url ?? url,
            title: event.title ?? event.draft.title,
            author: event.author ?? event.draft.author,
            itemIndex: 1,
            itemTotal: 1,
            percent: 100,
          });
          return;
        }
        if (event.type === "progress") {
          onProgress?.({
            stage: event.stage ?? "FETCHING_PAGE",
            message: event.message ?? "正在读取网页…",
            url: event.url ?? url,
            title: event.title,
            author: event.author,
            itemIndex: event.itemIndex ?? 1,
            itemTotal: event.itemTotal ?? 1,
            imageIndex: event.imageIndex,
            imageTotal: event.imageTotal,
            percent: event.percent ?? 0,
          });
        }
      },
    );
    if (!captured) throw new Error("抓取未返回文章内容，请重试或手动导入。");
    return captured;
  },
  batchImport: async (
    urls: string[],
    visibility: "PUBLIC" | "PRIVATE",
    tags: string,
    onProgress?: (progress: CaptureProgress) => void,
  ) => {
    let result: BatchImportResult | undefined;
    const completedItems: BatchImportItem[] = [];
    let lastProgress: CaptureProgress = {
      stage: "FETCHING_PAGE",
      message: "正在准备批量导入…",
      itemIndex: 1,
      itemTotal: urls.length,
      percent: 0,
      items: [],
    };
    await streamNdjson<ArticleStreamEvent>(
      "/articles/batch-import-stream",
      { method: "POST", body: JSON.stringify({ urls, visibility, tags }) },
      (event) => {
        if (event.type === "error") {
          const status = event.status ?? 400;
          const code = event.code ?? "BATCH_IMPORT_FAILED";
          throw createApiRequestError(status, {
            code,
            detail: event.message ?? "批量导入失败，请稍后重试。",
            type: `urn:humite:error:${code.toLowerCase()}`,
          });
        }
        if (event.type === "item" && event.item) {
          completedItems.push(event.item);
          lastProgress = {
            ...lastProgress,
            stage: event.stage ?? "ITEM_DONE",
            message: event.message ?? lastProgress.message,
            url: event.url ?? event.item.url,
            title: event.title ?? event.item.title,
            itemIndex: event.itemIndex ?? lastProgress.itemIndex,
            itemTotal: event.itemTotal ?? urls.length,
            imageIndex: 0,
            imageTotal: 0,
            percent: event.percent ?? lastProgress.percent,
            items: [...completedItems],
          };
          onProgress?.(lastProgress);
          return;
        }
        if (event.type === "result" && event.batchResult) {
          result = event.batchResult;
          lastProgress = {
            ...lastProgress,
            stage: "DONE",
            message: event.message ?? "批量导入已完成。",
            percent: 100,
            items: [...completedItems],
          };
          onProgress?.(lastProgress);
          return;
        }
        if (event.type === "progress") {
          lastProgress = {
            stage: event.stage ?? "FETCHING_PAGE",
            message: event.message ?? "正在读取网页…",
            url: event.url,
            title: event.title,
            author: event.author,
            itemIndex: event.itemIndex ?? lastProgress.itemIndex,
            itemTotal: event.itemTotal ?? urls.length,
            imageIndex: event.imageIndex,
            imageTotal: event.imageTotal,
            percent: event.percent ?? lastProgress.percent,
            items: [...completedItems],
          };
          onProgress?.(lastProgress);
        }
      },
    );
    if (!result) throw new Error("批量导入未返回结果，请刷新列表确认后重试。");
    return result;
  },
  prepare: (html: string, sourceUrl: string) =>
    request<{ html: string }>("/articles/prepare", {
      method: "POST",
      body: JSON.stringify({ html, sourceUrl }),
    }),
  save: (draft: Draft, id?: string) =>
    request<Article>(`/articles${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(draft),
    }),
  remove: (id: string) =>
    request<void>(`/articles/${id}`, { method: "DELETE" }),
  reading: (id: string) =>
    request<{ state: string; revision: number }>(`/articles/${id}/reading`),
  saveReading: (id: string, state: ReadingState, revision: number) =>
    request<void>(`/articles/${id}/reading`, {
      method: "PUT",
      body: JSON.stringify({ state: JSON.stringify(state), revision }),
    }),
  generate: (id: string) =>
    request<void>(`/articles/${id}/knowledge`, { method: "POST" }),
  knowledge: () =>
    request<{ id: string; title: string; points: string }[]>(
      "/articles/knowledge",
    ),
};
