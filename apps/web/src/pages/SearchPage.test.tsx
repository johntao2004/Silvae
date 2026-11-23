import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import * as permissionHooks from "../auth/permissions";
import { articleCollections } from "../features/article-collections/api";
import { articles } from "../features/content/api";
import { articleNotesApi } from "../features/notes/api";
import { readingPosts } from "../features/notes/posts-api";
import { TestProviders } from "../test/TestProviders";
import { SearchPage } from "./SearchPage";

beforeEach(() => {
  sessionStorage.setItem("humite-demo-session", JSON.stringify({ id: "user-owner", username: "owner", displayName: "林", role: "OWNER", mustChangePassword: false }));
  vi.spyOn(articles, "list").mockResolvedValue([]);
  vi.spyOn(articleCollections, "list").mockResolvedValue({ items: [] });
  vi.spyOn(articleNotesApi, "list").mockResolvedValue([]);
  vi.spyOn(readingPosts, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, "listBookKnowledge").mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

it("keeps signed-in search available without querying private or public books when library query is denied", async () => {
  const privateBooks = vi.spyOn(api, "listBooks");
  const publicBooks = vi.spyOn(api, "listDisplayBooks");
  const usePermissions = permissionHooks.usePermissions;
  vi.spyOn(permissionHooks, "usePermissions").mockImplementation(() => {
    const permissions = usePermissions();
    return { ...permissions, can: code => code !== "library.query" && permissions.can(code) };
  });

  render(<TestProviders initialPath="/search?q=river"><SearchPage /></TestProviders>);
  expect(await screen.findByText(/当前账号没有搜索书籍的权限/)).toBeInTheDocument();
  expect(privateBooks).not.toHaveBeenCalled();
  expect(publicBooks).not.toHaveBeenCalled();
});

it("blocks the search page independently from its directory-query capability", async () => {
  const privateBooks = vi.spyOn(api, "listBooks");
  const publicBooks = vi.spyOn(api, "listDisplayBooks");
  const usePermissions = permissionHooks.usePermissions;
  vi.spyOn(permissionHooks, "usePermissions").mockImplementation(() => {
    const permissions = usePermissions();
    return { ...permissions, can: code => code !== "library.search.view" && permissions.can(code) };
  });

  render(<TestProviders initialPath="/search?q=river"><SearchPage /></TestProviders>);
  expect(screen.getByRole("heading", { name: "搜索" })).toBeInTheDocument();
  expect(privateBooks).not.toHaveBeenCalled();
  expect(publicBooks).not.toHaveBeenCalled();
});

it("gates note, article, collection, post, booklist, and knowledge search sources by their corresponding read grants", async () => {
  const annotations = vi.spyOn(api, "listAnnotations");
  const booklists = vi.spyOn(api, "listBooklists");
  const denied = new Set(["notes.view", "booklists.view", "articles.view", "articles.collections.view", "notes.articles.view", "notes.posts.view", "knowledge.view"]);
  const usePermissions = permissionHooks.usePermissions;
  vi.spyOn(permissionHooks, "usePermissions").mockImplementation(() => {
    const permissions = usePermissions();
    return { ...permissions, can: code => !denied.has(code) && permissions.can(code) };
  });

  render(<TestProviders initialPath="/search?q=river"><SearchPage /></TestProviders>);
  expect(await screen.findByRole("heading", { name: "搜索" })).toBeInTheDocument();
  expect(annotations).not.toHaveBeenCalled();
  expect(booklists).not.toHaveBeenCalled();
  expect(articles.list).not.toHaveBeenCalled();
  expect(articleCollections.list).not.toHaveBeenCalled();
  expect(articleNotesApi.list).not.toHaveBeenCalled();
  expect(readingPosts.list).not.toHaveBeenCalled();
  expect(api.listBookKnowledge).not.toHaveBeenCalled();
});

it("never queries authenticated sources during anonymous search", async () => {
  sessionStorage.clear();
  const privateBooks = vi.spyOn(api, "listBooks");
  const annotations = vi.spyOn(api, "listAnnotations");
  render(<TestProviders initialPath="/search?q=river"><SearchPage /></TestProviders>);
  expect(await screen.findByText("“river”的搜索结果")).toBeInTheDocument();
  expect(privateBooks).not.toHaveBeenCalled();
  expect(annotations).not.toHaveBeenCalled();
  expect(articles.list).not.toHaveBeenCalled();
  expect(articleCollections.list).not.toHaveBeenCalled();
  expect(articleNotesApi.list).not.toHaveBeenCalled();
  expect(readingPosts.list).not.toHaveBeenCalled();
  expect(api.listBookKnowledge).not.toHaveBeenCalled();
});

it("renders global search results across articles, collections, notes, posts, booklists, and knowledge points without custom categories", async () => {
  const categories = vi.spyOn(api, "listCategories");
  vi.mocked(articles.list).mockResolvedValue([{ id: "art-1", title: "认知心理学导论", author: "作者甲", source_url: "https://example.test", published_at: "", visibility: "PUBLIC", tags: "心理", excerpt: "认识认知机制", created_at: "", updated_at: "" }]);
  vi.mocked(articleCollections.list).mockResolvedValue({ items: [{ id: "col-1", title: "认知专题合集", description: "精选认知文章", visibility: "MEMBERS", ownerDisplayName: "林", ownedByViewer: true, editable: true, articleCount: 2, previewArticles: [], revision: 1, createdAt: "", updatedAt: "" }] });
  vi.spyOn(api, "listAnnotations").mockResolvedValue([{ id: "bn-1", bookId: "book-1", bookTitle: "思考的框架", type: "NOTE", quote: "认知模型决定观察方式", note: "重点摘录", style: "HIGHLIGHT", locator: "cfi:1", createdAt: "2026-10-20" }]);
  vi.mocked(articleNotesApi.list).mockResolvedValue([{ articleId: "art-1", title: "认知心理学导论", author: "作者甲", annotations: [{ id: "an-1", type: "NOTE", quote: "认知负荷理论", note: "阅读批注", locator: "p-2", createdAt: "2026-10-21" }] }]);
  vi.mocked(readingPosts.list).mockResolvedValue({ items: [{ id: "post-1", kind: "ARTICLE", sourceId: "art-1", sourceTitle: "认知心理学导论", userId: "user-owner", authorName: "林", title: "关于认知边界的随笔", markdown: null, excerpt: "随笔节选", visibility: "PRIVATE", revision: 1, createdAt: "", updatedAt: "" }], nextCursor: null });
  vi.spyOn(api, "listBooklists").mockResolvedValue({ items: [{ id: "bl-1", title: "认知科学书单", description: "", kind: "PERSONAL", visibility: "PUBLIC", ownerDisplayName: "林", bookCount: 1, previewBooks: [], ownedByViewer: true, editable: true, revision: 1, hiddenPublicBookCount: 0, updatedAt: "" }] });
  vi.mocked(api.listBookKnowledge).mockResolvedValue([{ bookId: "book-1", status: "READY", providerId: "local", sampledSections: 1, totalSections: 4, generatedAt: "", points: [{ name: "认知偏差", quote: "系统性判断偏离", locator: "page:3" }] }]);

  render(<TestProviders initialPath="/search?q=认知"><SearchPage /></TestProviders>);

  const articleHeading = await screen.findByRole("heading", { name: "文章" });
  expect(within(articleHeading.closest("section")!).getByText("认知心理学导论")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "文章合集" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "认知专题合集" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "书籍笔记" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "思考的框架" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "文章笔记" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "阅读随笔" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "关于认知边界的随笔" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "书单" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "认知科学书单" })).toHaveAttribute("href", "/booklists/bl-1");
  expect(categories).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "分类" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "知识点" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "认知偏差" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "在知识图谱中查看" })).toHaveAttribute("href", `/knowledge-graph?q=${encodeURIComponent("认知偏差")}`);
});
