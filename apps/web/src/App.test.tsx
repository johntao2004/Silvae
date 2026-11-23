// 验证私有页面在匿名访问时不挂载，并区分公开发现入口与角色不足的 403。
// Checks private content never mounts anonymously and distinguishes public discovery from role-denied 403 routes.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { articles } from "./features/content/api";
import { articleCollections } from "./features/article-collections/api";
import { api, DEFAULT_SITE_SETTINGS } from "./api/client";
import { readingPosts } from "./features/notes/posts-api";
import { articleNotesApi } from "./features/notes/api";
import { TestProviders } from "./test/TestProviders";

// These route permission tests exercise post-initialization behavior; first-run routing has its own focused tests.
vi.mock("./auth/SetupGate", () => ({ SetupGate: (props: { children: import("react").ReactNode }) => props.children }));

const member = {
  id: "user-member",
  username: "member",
  displayName: "家庭成员",
  role: "MEMBER",
  mustChangePassword: false,
};

function RouteLocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function ReturnToProbe() {
  const location = useLocation();
  return <output data-testid="return-to">{(location.state as { from?: string } | null)?.from}</output>;
}

describe("App route permissions", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it.each(["/change-password", "/change-password/?from=bookmark#form"])(
    "redirects accounts that have completed the initial password change from %s",
    async path => {
      sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
      vi.spyOn(api, "listBooks").mockResolvedValue({ items: [] });
      const policy = vi.spyOn(api, "passwordPolicy");
      render(<TestProviders initialPath={path}><App /><RouteLocationProbe /></TestProviders>);

      expect(await screen.findByRole("heading", { name: "全部藏书" }, { timeout: 15_000 })).toBeInTheDocument();
      expect(screen.getByTestId("route-location")).toHaveTextContent(/^\/library$/);
      expect(screen.queryByLabelText("新密码")).not.toBeInTheDocument();
      expect(policy).not.toHaveBeenCalled();
    },
  );

  it("allows a required password change and returns to the library after saving", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({
      ...member, mustChangePassword: true, canChangePasswordWithoutCurrent: true,
    }));
    vi.spyOn(api, "listBooks").mockResolvedValue({ items: [] });
    vi.spyOn(api, "passwordPolicy").mockResolvedValue({
      minLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecial: false,
    });
    const save = vi.spyOn(api, "changePassword").mockResolvedValue({ ...member, role: "MEMBER" });
    render(<TestProviders initialPath="/articles"><App /><RouteLocationProbe /></TestProviders>);

    expect(await screen.findByLabelText("新密码")).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent(/^\/change-password$/);
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-river-07" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-river-07" } });
    const submit = screen.getByRole("button", { name: "保存后进书库" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(await screen.findByRole("heading", { name: "全部藏书" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent(/^\/library$/);
    expect(save).toHaveBeenCalledWith({ newPassword: "new-river-07" });
  });

  it.each(["/annotations", "/annotations/books", "/annotations/articles", "/annotations/all", "/annotations/posts/article/post-1"])("protects the reading-note page %s before loading private posts", async path => {
    const list = vi.spyOn(readingPosts, "list");
    const get = vi.spyOn(readingPosts, "get");
    render(<TestProviders initialPath={path}><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "需要登录" })).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ["/annotations", "/annotations"],
    ["/annotations/all?view=cards#notes", "/annotations?view=cards#notes"],
  ])("uses the parent notes page as the overview for %s", async (initialPath, expectedPath) => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    vi.spyOn(api, "listAnnotationBooks").mockResolvedValue({ items: [] });
    vi.spyOn(articleNotesApi, "list").mockResolvedValue([]);
    vi.spyOn(articles, "list").mockResolvedValue([]);
    vi.spyOn(readingPosts, "list").mockResolvedValue({ items: [], nextCursor: null });
    render(<TestProviders initialPath={initialPath}><RouteLocationProbe /><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "阅读笔记", level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent(expectedPath);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText("书籍+文章")).not.toBeInTheDocument();
  });

  it("serves only the public catalog at the unified anonymous entry even with an all scope", async () => {
    const privateBooks = vi.spyOn(api, "listBooks");
    const publicBooks = vi.spyOn(api, "listDisplayBooks").mockResolvedValue({ items: [], revision: 1 });
    render(<TestProviders initialPath="/library?scope=all"><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "藏书楼", level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(publicBooks).toHaveBeenCalled());
    expect(privateBooks).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "上传书籍" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "文章" })).not.toBeInTheDocument();
  });

  it.each(["MEMBER", "ADMIN", "OWNER"])("opens the merged library for %s and retains management permissions", async role => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({ ...member, role }));
    vi.spyOn(api, "listBooks").mockResolvedValue({ items: [] });
    render(<TestProviders initialPath="/library"><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "全部藏书" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(Boolean(screen.queryByRole("button", { name: "上传书籍" }))).toBe(role !== "MEMBER");
    expect(screen.queryByRole("link", { name: "知识图谱" })).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole("link", { name: "藏书楼" }));
    expect(await screen.findByRole("link", { name: "知识图谱" })).toHaveAttribute("href", "/knowledge-graph");
  });

  it("blocks anonymous overview access before private requests mount", async () => {
    const overview = vi.spyOn(api, "getReadingOverview");
    const books = vi.spyOn(api, "listBooks");
    render(<TestProviders initialPath="/library/overview"><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "需要登录" })).toBeInTheDocument();
    expect(books).not.toHaveBeenCalled();
    expect(overview).not.toHaveBeenCalled();
  });

  it.each(["MEMBER", "ADMIN", "OWNER"])("opens the standalone overview for %s", async role => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({ ...member, role }));
    vi.spyOn(api, "listBooks").mockResolvedValue({ items: [] });
    render(<TestProviders initialPath="/library/overview"><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "书库概览", level: 1 }, { timeout: 15_000 })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "书库概览" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "全部藏书" })).not.toBeInTheDocument();
  });

  it("keeps filters, hash and return state when normalizing the old private library address", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    render(<TestProviders initialPath="/library/all?q=river&format=PDF&sort=title#books"><><App /><RouteLocationProbe /></></TestProviders>);
    await waitFor(() => expect(screen.getByTestId("route-location")).toHaveTextContent("/library?q=river&format=PDF&sort=title#books"));
  });

  it.each(["/recycle-bin", "/admin/recycle-bin"])("keeps members out of the regrouped recycle bin through %s", async path => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    render(<TestProviders initialPath={path}><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "权限受限" })).toBeInTheDocument();
  });

  it.each(["/articles?tag=essay&sort=title#catalog", "/articles/article-one"])("requires login for %s without requesting article content", async (path) => {
    const list = vi.spyOn(articles, "list").mockResolvedValue([]);
    const get = vi.spyOn(articles, "get");
    render(<TestProviders initialPath={path}><><App /><RouteLocationProbe /><ReturnToProbe /></></TestProviders>);

    expect(await screen.findByRole("heading", { name: "需要登录" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "文章" })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "登录" }));
    await waitFor(() => expect(screen.getByTestId("route-location")).toHaveTextContent("/login"));
    expect(screen.getByTestId("return-to")).toHaveTextContent(path);
  });

  it.each(["MEMBER", "ADMIN", "OWNER"])("allows a signed-in %s to view article collections", async (role) => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({ ...member, role }));
    const list = vi.spyOn(articles, "list").mockResolvedValue([]);
    render(<TestProviders initialPath="/articles"><App /></TestProviders>);

    expect(await screen.findByRole("heading", { name: "文章" }, { timeout: 15_000 })).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "文章" })).toHaveAttribute("href", "/articles");
  });

  it("blocks a signed-out direct visit before private library content mounts", async () => {
    render(<TestProviders initialPath="/library/all"><App /></TestProviders>);

    expect(await screen.findByRole("heading", { name: "需要登录" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "全部藏书" })).not.toBeInTheDocument();
  });

  it("shows public details on a signed-out direct visit without mounting private metadata", async () => {
    const privateBook = vi.spyOn(api, "getBook");
    const metadata = vi.spyOn(api, "getBookMetadata");
    vi.spyOn(api, "getDisplayBook").mockResolvedValue({ id: "book-1", title: "公开书籍", author: "作者", description: "公开简介", format: "PDF", coverUrl: "", available: true, sortOrder: 1 });
    render(<TestProviders initialPath="/library/books/book-1"><App /></TestProviders>);

    expect(await screen.findByRole("heading", { name: "公开书籍", level: 2 }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "书籍详情", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始阅读" })).toBeEnabled();
    expect(privateBook).not.toHaveBeenCalled();
    expect(metadata).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "编辑元信息" })).not.toBeInTheDocument();
  });

  it("retains the details permission for signed-in accounts before private requests mount", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    sessionStorage.setItem("humite-demo-role-permissions", JSON.stringify({ revision: 1, grants: { MEMBER: [], ADMIN: [], OWNER: [] } }));
    const privateBook = vi.spyOn(api, "getBook");
    const publicBook = vi.spyOn(api, "getDisplayBook");
    const metadata = vi.spyOn(api, "getBookMetadata");
    render(<TestProviders initialPath="/library/books/book-1"><App /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "权限受限" })).toBeInTheDocument();
    expect(privateBook).not.toHaveBeenCalled();
    expect(publicBook).not.toHaveBeenCalled();
    expect(metadata).not.toHaveBeenCalled();
  });

  it("allows anonymous access to the feature-gated public 3D route without private catalog requests", async () => {
    vi.spyOn(api, "siteSettings").mockResolvedValue({ ...DEFAULT_SITE_SETTINGS, virtualLibraryEnabled: false });
    const books = vi.spyOn(api, "listBooks"); const revision = vi.spyOn(api, "catalogRevision");
    render(<TestProviders initialPath="/virtual-library"><App /></TestProviders>);
    expect(await screen.findByRole("heading", {name:"3D 书库未启用"}, { timeout: 15_000 })).toBeInTheDocument();
    expect(books).not.toHaveBeenCalled(); expect(revision).not.toHaveBeenCalled();
  });

  it("keeps the explicit public discovery route available anonymously", async () => {
    render(<TestProviders initialPath="/library"><App /></TestProviders>);

    expect(await screen.findByRole("heading", { name: "藏书楼", level: 1 }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", {level: 1, name: "401"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "文章" })).not.toBeInTheDocument();
  });

  it("redirects legacy category routes into the signed-in library and preserves filters", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    render(<TestProviders initialPath="/categories/path-category?category=query-category&manage=1&q=lamp&format=PDF&sort=title#results"><><App /><RouteLocationProbe /></></TestProviders>);

    await waitFor(() => expect(screen.getByTestId("route-location")).toHaveTextContent("/library?"));
    const redirected = new URL(screen.getByTestId("route-location").textContent ?? "", window.location.origin);
    expect(redirected.pathname).toBe("/library");
    expect(redirected.searchParams.get("category")).toBe("path-category");
    expect(redirected.searchParams.get("advanced")).toBe("1");
    expect(redirected.searchParams.get("manage")).toBe("1");
    expect(redirected.searchParams.get("q")).toBe("lamp");
    expect(redirected.searchParams.get("format")).toBe("PDF");
    expect(redirected.searchParams.get("sort")).toBe("title");
    expect(redirected.hash).toBe("#results");
  });

  it("redirects legacy category browse visits to the anonymous library and retains query category", async () => {
    render(<TestProviders initialPath="/categories?category=fiction&manage=0&q=river&format=EPUB&sort=author#books"><><App /><RouteLocationProbe /></></TestProviders>);

    await waitFor(() => expect(screen.getByTestId("route-location")).toHaveTextContent("/library?"));
    const redirected = new URL(screen.getByTestId("route-location").textContent ?? "", window.location.origin);
    expect(redirected.pathname).toBe("/library");
    expect(redirected.searchParams.get("category")).toBe("fiction");
    expect(redirected.searchParams.get("advanced")).toBe("1");
    expect(redirected.searchParams.get("manage")).toBe("0");
    expect(redirected.searchParams.get("q")).toBe("river");
    expect(redirected.searchParams.get("format")).toBe("EPUB");
    expect(redirected.searchParams.get("sort")).toBe("author");
    expect(redirected.hash).toBe("#books");
  });

  it("renders matching anonymous book and public booklist links without polluting library search filters", async () => {
    render(<TestProviders initialPath="/search?q=灯塔"><App /></TestProviders>);

    const bookLink = await screen.findByRole("link", { name: "灯塔以南封面" }, { timeout: 15_000 });
    expect(bookLink).toHaveAttribute("href", "/reader/book-7");
    const publicListLink = await screen.findByRole("link", { name: "灯塔与远方" }, { timeout: 15_000 });
    expect(publicListLink).toHaveAttribute("href", "/booklists/booklist-public");
    expect(screen.queryByRole("link", { name: "周末共读" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "分类" })).not.toBeInTheDocument();
  });

  it("renders matching signed-in book and booklist links without polluting library search filters", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    vi.spyOn(articles, "list").mockResolvedValue([]);
    vi.spyOn(articleCollections, "list").mockResolvedValue({ items: [] });
    vi.spyOn(articleNotesApi, "list").mockResolvedValue([]);
    vi.spyOn(readingPosts, "list").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(api, "listBookKnowledge").mockResolvedValue([]);
    render(<TestProviders initialPath="/search?q=灯塔"><App /></TestProviders>);

    const bookLink = await screen.findByRole("link", { name: "灯塔以南封面" }, { timeout: 15_000 });
    expect(bookLink).toHaveAttribute("href", "/reader/book-7");
    expect(await screen.findByRole("link", { name: "灯塔与远方" }, { timeout: 15_000 })).toHaveAttribute("href", "/booklists/booklist-public");
    expect(await screen.findByRole("link", { name: "周末共读" }, { timeout: 15_000 })).toHaveAttribute("href", "/booklists/booklist-weekend");
    expect(screen.queryByRole("heading", { name: "分类" })).not.toBeInTheDocument();
  });

  it("shows the 403 route page for an authenticated member on administration routes", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    render(<TestProviders initialPath="/admin/users"><App /></TestProviders>);

    expect(await screen.findByRole("heading", { name: "权限受限" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "用户管理" })).not.toBeInTheDocument();
  });

  it.each([
    ["", "#users"],
    ["#users", "#users"],
    ["#operations", "#catalog/operations"],
    ["#users/operations", "#catalog/operations"],
    ["#logins", "#users/logins"],
    ["#sessions", "#users/sessions"],
    ["#security", "#users/security"],
  ])("preserves legacy /admin/users link %s when redirecting to settings", async (hash, destination) => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({ ...member, role: "OWNER" }));
    render(<TestProviders initialPath={`/admin/users?source=bookmark${hash}`}><App /><RouteLocationProbe /></TestProviders>);

    await waitFor(() => expect(screen.getByTestId("route-location")).toHaveTextContent(`/settings?source=bookmark${destination}`), { timeout: 15_000 });
  });

  it("flattens /admin/recycle-bin directly to /settings#catalog/recycle-bin for administrators", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({ ...member, role: "ADMIN" }));
    render(<TestProviders initialPath="/admin/recycle-bin"><App /><RouteLocationProbe /></TestProviders>);

    await waitFor(() => expect(screen.getByTestId("route-location")).toHaveTextContent("/settings#catalog/recycle-bin"), { timeout: 15_000 });
  });

  it("redirects /recover directly to /forgot-password while preserving search and hash", async () => {
    const resetView = render(<TestProviders initialPath={`/recover?from=mail#reset=${"a".repeat(43)}`}><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "重置密码" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent(`/forgot-password?from=mail#reset=${"a".repeat(43)}`);
    expect(screen.getByRole("button", { name: "重置密码" })).toBeInTheDocument();
    resetView.unmount();

    const bindView = render(<TestProviders initialPath={`/recover?from=mail#bind=${"b".repeat(43)}`}><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "验证找回邮箱" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent(`/forgot-password?from=mail#bind=${"b".repeat(43)}`);
    expect(screen.getByRole("button", { name: "确认绑定邮箱" })).toBeInTheDocument();
    bindView.unmount();

    render(<TestProviders initialPath="/forgot-password"><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "忘记密码" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送重置链接" })).toBeInTheDocument();
  });

  it("redirects /booklists and /article-collections directly to /discover tabs", async () => {
    vi.spyOn(api, "listBooklists").mockResolvedValue({ items: [] });
    const anonView = render(<TestProviders initialPath="/booklists"><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "发现", level: 1 }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/discover?tab=booklists");
    expect(screen.getByRole("tab", { name: "书单" })).toHaveAttribute("aria-selected", "true");
    anonView.unmount();

    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    vi.spyOn(articleCollections, "list").mockResolvedValue({ items: [] });
    render(<TestProviders initialPath="/article-collections"><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "发现", level: 1 }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/discover?tab=collections");
    expect(screen.getByRole("tab", { name: "文章合集" })).toHaveAttribute("aria-selected", "true");
  });

  it("redirects legacy /annotations query links to scoped reading-note routes", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    vi.spyOn(api, "listAnnotationBooks").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listAnnotations").mockResolvedValue([]);
    vi.spyOn(api, "getBook").mockResolvedValue({
      id: "book-1",
      fileId: "book-1",
      title: "山川与灯火",
      author: "顾远",
      description: "",
      format: "EPUB",
      coverUrl: "",
      progress: 0,
      addedAt: "2026-08-18T00:00:00Z",
      libraryRoot: "主书库",
      relativePath: "顾远/山川与灯火.epub",
      fingerprint: "sha256:01",
      status: "AVAILABLE",
      tags: [],
    });
    vi.spyOn(articleNotesApi, "list").mockResolvedValue([]);
    vi.spyOn(articles, "list").mockResolvedValue([]);
    vi.spyOn(readingPosts, "list").mockResolvedValue({ items: [], nextCursor: null });

    const articlesRedirect = render(<TestProviders initialPath="/annotations?type=articles"><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "文章笔记", level: 1 }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/annotations/articles?view=annotations");
    expect(await screen.findByRole("heading", { name: "暂无阅读笔记" })).toBeInTheDocument();
    articlesRedirect.unmount();

    const bookRedirect = render(<TestProviders initialPath="/annotations?bookId=book-1&q=preserve"><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "山川与灯火" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/annotations/books?bookId=book-1&q=preserve&view=annotations");
    fireEvent.click(screen.getByRole("button", { name: "返回书籍笔记" }));
    await waitFor(() => expect(screen.getByTestId("route-location")).toHaveTextContent("/annotations/books?q=preserve&view=annotations"));
    bookRedirect.unmount();

    render(<TestProviders initialPath="/annotations?q=not-found"><App /><RouteLocationProbe /></TestProviders>);
    expect(await screen.findByRole("heading", { name: "暂无阅读笔记" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/annotations/books?q=not-found&view=annotations");
  });
});
