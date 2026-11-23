// 覆盖菜单离开关闭、输入法提交与移动端导航可达性，不只验证桌面静态渲染。
// Covers pointer-leave menus, IME submission and mobile navigation reachability beyond static desktop rendering.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { api, DEFAULT_SITE_SETTINGS } from "../api/client";
import { vaultAccessApi } from "../features/vault/access-api";
import { VaultPolicySettings } from "../pages/VaultPolicySettings";
import { AppShell } from "./AppShell";
import { HumiteThemeProvider } from "../theme/HumiteThemeProvider";

const authState = vi.hoisted(() => ({ signedIn: true, role: "OWNER" as "OWNER" | "MEMBER" }));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: authState.signedIn ? { id: "user-owner", username: "owner", displayName: "林", role: authState.role, mustChangePassword: false } : null,
    logout: vi.fn(),
    ready: true,
  }),
}));

const sceneImported = vi.hoisted(() => vi.fn());
vi.mock("../pages/MingLibraryExperience", () => {
  sceneImported();
  return {MingLibraryExperience: () => null};
});

function RouteProbe() {
  const location = useLocation();
  return <output data-testid="search-route">{location.pathname}{location.search}</output>;
}

function renderShell(initialPath: string, virtualLibraryEnabled = true, extraContent?: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(['site-settings'], {...DEFAULT_SITE_SETTINGS, virtualLibraryEnabled});
  vi.spyOn(api, "siteSettings").mockResolvedValue({...DEFAULT_SITE_SETTINGS, virtualLibraryEnabled});
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <HumiteThemeProvider>
          <AppShell><div>正文</div><RouteProbe />{extraContent}</AppShell>
        </HumiteThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const originalMatchMedia = window.matchMedia;

function mockMobileViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(max-width: 767.95px)" ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authState.signedIn = true;
    authState.role = "OWNER";
    mockMobileViewport(false);
    vi.spyOn(vaultAccessApi, "status").mockResolvedValue({ enabled: true, configured: true, bound: true, verified: true, expiresAt: Date.now() + 1000 });
  });
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(["/library/books/book-1", "/annotations/books", "/vault", "/article-collections/collection-1"])("keeps 文章 as a direct link without dropdown or active state outside article pages on %s", (path) => {
    renderShell(path);
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("link", { name: "文章" });
    expect(trigger).toHaveAttribute("href", "/articles");
    expect(trigger).not.toHaveAttribute("aria-haspopup");
    expect(trigger).not.toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("search-route")).toHaveTextContent(path);
  });

  it("routes collections under 发现 and renders 文章 without dropdown or mobile subnav", async () => {
    const desktopView = renderShell("/article-collections/collection-1");
    const discover = screen.getByRole("link", { name: "发现" });
    const articlesLink = screen.getByRole("link", { name: "文章" });
    expect(discover).toHaveAttribute("aria-current", "page");
    expect(articlesLink).not.toHaveAttribute("aria-current", "page");
    expect(articlesLink).not.toHaveAttribute("aria-haspopup");
    desktopView.unmount();

    mockMobileViewport(true);
    const mobileArticles = renderShell("/articles");
    const articlesBottomNav = screen.getByRole("navigation", { name: "底部导航" });
    expect(within(articlesBottomNav).getByRole("link", { name: "文章" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "分区导航" })).not.toBeInTheDocument();
    mobileArticles.unmount();

    renderShell("/article-collections");
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();
    const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
    await within(bottomNav).findByRole("link", { name: "发现" });
    expect(within(bottomNav).getByRole("link", { name: "发现" })).toHaveAttribute("aria-current", "page");
    expect(within(bottomNav).getByRole("link", { name: "文章" })).not.toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "分区导航" })).not.toBeInTheDocument();
  });

  it("groups the two source pages below the reading-note overview in desktop and mobile navigation", async () => {
    const desktopView = renderShell("/annotations/articles");
    const trigger = screen.getByRole("link", { name: "阅读笔记" });
    expect(trigger).toHaveAttribute("aria-current", "page");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("link", { name: "书籍笔记" })).toHaveAttribute("href", "/annotations/books");
    expect(within(menu).getByRole("link", { name: "文章笔记" })).toHaveAttribute("href", "/annotations/articles");
    expect(within(menu).queryByRole("link", { name: "书籍+文章" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("href", "/annotations");
    fireEvent.keyDown(trigger, { key: "Escape" });
    desktopView.unmount();

    mockMobileViewport(true);
    renderShell("/annotations/articles");
    const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
    expect(within(bottomNav).getByRole("link", { name: "笔记" })).toHaveAttribute("aria-current", "page");
    const subNav = screen.getByRole("navigation", { name: "分区导航" });
    expect(within(subNav).getByRole("link", { name: "全部笔记" })).toBeInTheDocument();
    expect(within(subNav).getByRole("link", { name: "文章笔记" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(subNav).getByRole("link", { name: "书籍笔记" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/annotations/books");
  });

  it("automatically closes the theme dropdown when the pointer leaves", async () => {
    renderShell("/library");
    const trigger = screen.getByRole("button", { name: "切换全站主题" });
    fireEvent.mouseEnter(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });

  it("opens search on hover and preserves the query after Escape or blur", () => {
    renderShell("/library");
    const trigger = screen.getByRole("button", { name: "展开搜索" });
    expect(screen.queryByRole("textbox", { name: "搜索书籍、文章、笔记、书单" })).not.toBeInTheDocument();
    fireEvent.mouseEnter(trigger);
    const input = screen.getByRole("textbox", { name: "搜索书籍、文章、笔记、书单" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "文学" } });
    fireEvent.mouseLeave(trigger.parentElement!);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.mouseEnter(trigger);
    const reopenedInput = screen.getByRole("textbox", { name: "搜索书籍、文章、笔记、书单" });
    fireEvent.keyDown(reopenedInput, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("textbox", { name: "搜索书籍、文章、笔记、书单" })).toHaveValue("文学");
    fireEvent.blur(screen.getByRole("textbox", { name: "搜索书籍、文章、笔记、书单" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("submits global search without changing local filters or submitting IME composition", () => {
    renderShell("/categories?format=PDF");
    fireEvent.click(screen.getByRole("button", { name: "展开搜索" }));
    const input = screen.getByRole("textbox", { name: "搜索书籍、文章、笔记、书单" });
    fireEvent.change(input, { target: { value: "文学" } });
    expect(screen.getByTestId("search-route")).toHaveTextContent("/categories?format=PDF");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByTestId("search-route")).toHaveTextContent("/categories?format=PDF");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("search-route")).toHaveTextContent(`/search?q=${encodeURIComponent("文学")}`);
  });

  it("keeps the global navigation above reader routes", () => {
    renderShell("/reader/book-1");

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "全站导航" })).toHaveStyle({ width: "100%", maxWidth: "none" });
    expect(screen.getByRole("link", { name: "Humite" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("main")).toHaveTextContent("正文");
  });

  it("keeps the global navigation on library routes", async () => {
    renderShell("/library");

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "全站导航" })).toBeInTheDocument();
    const wordmark = screen.getByRole("link", { name: "Humite" });
    expect(wordmark).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();
    expect(wordmark.previousElementSibling).toBeNull();
    expect(screen.queryByRole("link", { name: "分类" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "全站导航" })).queryByRole("link", { name: "书单" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "藏书楼" })).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getByRole("link", { name: "阅读笔记" })).toBeInTheDocument();
    await screen.findByRole("link", { name: "加密书库" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "全站导航" })).getByRole("link", { name: "加密书库" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/vault");
    expect(screen.getByRole("link", { name: "加密书库" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "3D 书库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "首页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "知识图谱" })).not.toBeInTheDocument();
    expect(screen.queryByText("已同步")).not.toBeInTheDocument();
  });

  it("shows 加密书库 only after the visit-authorized status confirms it is enabled", async () => {
    vi.mocked(vaultAccessApi.status).mockResolvedValue({ enabled: false, configured: true, bound: false, verified: false, expiresAt: 0 });
    mockMobileViewport(true);
    renderShell("/library");
    await waitFor(() => expect(vaultAccessApi.status).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("link", { name: "加密书库" })).not.toBeInTheDocument();
    const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
    expect(within(bottomNav).queryByRole("link", { name: "加密库" })).not.toBeInTheDocument();
    expect(within(bottomNav).getByRole("link", { name: "发现" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();
  });

  it("updates same-tab navigation immediately after the owner saves the enabled policy", async () => {
    vi.mocked(vaultAccessApi.status).mockResolvedValue({ enabled: false, configured: true, bound: false, verified: false, expiresAt: 0 });
    vi.spyOn(vaultAccessApi, "policy").mockResolvedValue({ enabled: false, configured: true, revision: 2 });
    vi.spyOn(vaultAccessApi, "savePolicy").mockResolvedValue({ enabled: true, configured: true, revision: 3 });
    renderShell("/library", true, <VaultPolicySettings />);
    const toggle = await screen.findByRole("switch", { name: "启用加密书库" });
    expect(screen.queryByRole("link", { name: "加密书库" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    await screen.findByRole("link", { name: "加密书库" });
  });

  it("keeps the current navigation state when saving the policy fails", async () => {
    vi.mocked(vaultAccessApi.status).mockResolvedValue({ enabled: true, configured: true, bound: true, verified: false, expiresAt: 0 });
    vi.spyOn(vaultAccessApi, "policy").mockResolvedValue({ enabled: true, configured: true, revision: 2 });
    vi.spyOn(vaultAccessApi, "savePolicy").mockRejectedValue(new Error("保存失败"));
    renderShell("/library", true, <VaultPolicySettings />);
    await screen.findByRole("link", { name: "加密书库" });
    fireEvent.click(await screen.findByRole("switch", { name: "启用加密书库" }));
    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "加密书库" })).toBeInTheDocument();
  });

  it("keeps a confirmed enabled link during refresh and hides it after refresh failure", async () => {
    let rejectRefresh!: (reason: Error) => void;
    vi.mocked(vaultAccessApi.status).mockResolvedValueOnce({ enabled: true, configured: true, bound: true, verified: false, expiresAt: 0 })
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectRefresh = reject; }));
    const { queryClient } = renderShell("/library");
    await screen.findByRole("link", { name: "加密书库" });
    void queryClient.invalidateQueries({ queryKey: ["vault-navigation-status", "user-owner"] });
    await waitFor(() => expect(vaultAccessApi.status).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("link", { name: "加密书库" })).toBeInTheDocument();
    rejectRefresh(new Error("offline"));
    await waitFor(() => expect(screen.queryByRole("link", { name: "加密书库" })).not.toBeInTheDocument());
  });

  it("does not expose 加密书库 while status is unknown, denied, or the visitor is anonymous", async () => {
    vi.mocked(vaultAccessApi.status).mockImplementation(() => new Promise(() => undefined));
    const { unmount } = renderShell("/library");
    expect(screen.queryByRole("link", { name: "加密书库" })).not.toBeInTheDocument();
    unmount();
    vi.mocked(vaultAccessApi.status).mockRejectedValueOnce(new Error("forbidden"));
    const failed = renderShell("/library");
    await waitFor(() => expect(vaultAccessApi.status).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("link", { name: "加密书库" })).not.toBeInTheDocument();
    failed.unmount();
    authState.role = "MEMBER";
    sessionStorage.setItem("humite-demo-role-permissions", JSON.stringify({ revision: 0, grants: { OWNER: [], ADMIN: [], MEMBER: [] } }));
    vi.mocked(vaultAccessApi.status).mockClear();
    const denied = renderShell("/library");
    expect(vaultAccessApi.status).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "加密书库" })).not.toBeInTheDocument();
    denied.unmount();
    authState.signedIn = false;
    renderShell("/library");
    expect(vaultAccessApi.status).not.toHaveBeenCalled();
    expect(screen.queryByText("加密书库")).not.toBeInTheDocument();
  });

  it("keeps search, theme, and account controls reachable in the phone header", () => {
    renderShell("/library");
    const search = screen.getByRole("button", { name: "展开搜索" });
    const theme = screen.getByRole("button", { name: "切换全站主题" });
    const account = screen.getByRole("button", { name: "账户菜单" });
    const precedes = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(precedes(search, theme)).toBe(true);
    expect(precedes(theme, account)).toBe(true);
    fireEvent.click(search);

    const input = screen.getByRole("textbox", { name: "搜索书籍、文章、笔记、书单" });
    expect(input).toHaveFocus();

  });

  it("keeps management in the desktop account menu and deduplicates mobile navigation across bottom bar and account menu", async () => {
    const desktopView = renderShell("/library");
    await screen.findByRole("link", { name: "加密书库" });
    fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
    const desktopAccountMenu = screen.getByRole("menu");
    expect(within(desktopAccountMenu).getByRole("menuitem", { name: "管理设置" })).toBeInTheDocument();
    expect(within(desktopAccountMenu).queryByRole("menuitem", { name: "加密书库" })).not.toBeInTheDocument();
    desktopView.unmount();

    mockMobileViewport(true);
    const ownerMobile = renderShell("/library");
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "移动端导航" })).not.toBeInTheDocument();

    const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
    await waitFor(() => expect(vaultAccessApi.status).toHaveBeenCalled());
    expect(within(bottomNav).getAllByRole("link").map((link) => link.textContent)).toEqual(["藏书", "发现", "文章", "笔记", "设置"]);
    expect(within(bottomNav).getByRole("link", { name: "藏书" })).toHaveAttribute("aria-current", "page");

    const subNav = screen.getByRole("navigation", { name: "分区导航" });
    expect(within(subNav).getAllByRole("link").map((link) => link.textContent)).toEqual(["全部藏书", "书库概览", "知识图谱", "3D 书库"]);
    expect(within(subNav).getByRole("link", { name: "全部藏书" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(subNav).getByRole("link", { name: "书库概览" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/library/overview");
    expect(within(subNav).getByRole("link", { name: "书库概览" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
    const accountMenu = screen.getByRole("menu");
    expect(within(accountMenu).getByRole("menuitem", { name: "加密书库" })).toBeInTheDocument();
    expect(within(accountMenu).queryByRole("menuitem", { name: "管理设置" })).not.toBeInTheDocument();
    expect(within(accountMenu).queryByRole("menuitem", { name: "用户管理" })).not.toBeInTheDocument();
    expect(within(accountMenu).queryByRole("menuitem", { name: "展示书目设置" })).not.toBeInTheDocument();
    fireEvent.click(within(accountMenu).getByRole("menuitem", { name: "加密书库" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/vault");
    ownerMobile.unmount();

    authState.role = "MEMBER";
    renderShell("/library");
    const memberBottomNav = screen.getByRole("navigation", { name: "底部导航" });
    await within(memberBottomNav).findByRole("link", { name: "加密库" });
    expect(within(memberBottomNav).getAllByRole("link").map((link) => link.textContent)).toEqual(["藏书", "发现", "文章", "笔记", "加密库"]);
    fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
    const memberMenu = screen.getByRole("menu");
    expect(within(memberMenu).queryByRole("menuitem", { name: "加密书库" })).not.toBeInTheDocument();
    expect(within(memberMenu).queryByRole("menuitem", { name: "管理设置" })).not.toBeInTheDocument();
  });

  it("keeps search, theme, and account controls reachable on mobile without any hamburger menu", () => {
    mockMobileViewport(true);
    renderShell("/library");
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开搜索" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换全站主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "账户菜单" })).toBeInTheDocument();
  });

  it("expands global search in-place inside the top toolbar without dropping below it", () => {
    mockMobileViewport(true);
    renderShell("/library");
    const search = screen.getByRole("button", { name: "展开搜索" });
    fireEvent.click(search);

    const panel = screen.getByTestId("global-navigation-search-panel");
    expect(panel).toHaveStyle({ top: "0px" });
    const input = screen.getByRole("textbox", { name: "搜索书籍、文章、笔记、书单" });
    expect(input).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }));
    expect(search).toHaveAttribute("aria-expanded", "false");
    expect(search).toHaveFocus();
  });

  it("does not import 3D or prefetch its catalog while idle or approaching its link", async () => {
    vi.useFakeTimers();
    const listBooks = vi.spyOn(api, "listBooks").mockResolvedValue({ items: [] });
    const revision = vi.spyOn(api, "catalogRevision");
    renderShell("/library");
    const link = screen.getByRole("link", { name: "藏书楼" });
    fireEvent.mouseEnter(link); fireEvent.focus(link); fireEvent.touchStart(link);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(sceneImported).not.toHaveBeenCalled();
    expect(listBooks).not.toHaveBeenCalled();
    expect(revision).not.toHaveBeenCalled();
  });

  it("hides the disabled 3D child in desktop and mobile navigation", async () => {
    const desktopView = renderShell("/library", false);
    const trigger = screen.getByRole("link", { name: "藏书楼" });
    fireEvent.mouseEnter(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("link", { name: "知识图谱" })).toBeInTheDocument();
    expect(within(menu).queryByText("3D 书库")).not.toBeInTheDocument();
    desktopView.unmount();

    mockMobileViewport(true);
    renderShell("/library", false);
    const subNav = screen.getByRole("navigation", { name: "分区导航" });
    expect(within(subNav).getByRole("link", { name: "知识图谱" })).toBeInTheDocument();
    expect(within(subNav).queryByText("3D 书库")).not.toBeInTheDocument();
  });

  it("opens a secondary route from the desktop dropdown and keeps the parent selected", async () => {
    renderShell("/library");
    const trigger = screen.getByRole("link", { name: "藏书楼" });
    fireEvent.mouseEnter(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["书库概览", "知识图谱", "3D 书库"]);
    expect(screen.getByTestId("search-route")).toHaveTextContent("/library");
    expect(within(menu).getByRole("link", { name: "书库概览" })).toHaveAttribute("href", "/library/overview");
    fireEvent.click(within(menu).getByRole("link", { name: "知识图谱" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/knowledge-graph");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-current", "page");
  });

  it.each(["/booklists", "/booklists/list-one"])("keeps discovery active at %s without showing booklists under library", async (path) => {
    renderShell(path);
    const discover = screen.getByRole("link", { name: "发现" });
    const library = screen.getByRole("link", { name: "藏书楼" });
    expect(discover).toHaveAttribute("aria-current", "page");
    expect(library).not.toHaveAttribute("aria-current", "page");
    fireEvent.keyDown(library, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("link", { name: "书单" })).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(library).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the parent a direct catalog link when its submenu is open", async () => {
    renderShell("/knowledge-graph");
    const parent = screen.getByRole("link", { name: "藏书楼" });
    expect(parent).toHaveAttribute("href", "/library");
    fireEvent.mouseEnter(parent);
    await screen.findByRole("menu");
    expect(screen.getByTestId("search-route")).toHaveTextContent("/knowledge-graph");
    fireEvent.click(parent);
    expect(screen.getByTestId("search-route")).toHaveTextContent("/library");
    expect(parent).toHaveAttribute("aria-expanded", "false");
  });

  it("navigates across library subsections and bottom tabs on mobile without a drawer", () => {
    mockMobileViewport(true);
    renderShell("/library/overview");
    const subNav = screen.getByRole("navigation", { name: "分区导航" });
    fireEvent.click(within(subNav).getByRole("link", { name: "全部藏书" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/library");

    const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
    fireEvent.click(within(bottomNav).getByRole("link", { name: "设置" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/settings");
    expect(screen.queryByRole("navigation", { name: "分区导航" })).not.toBeInTheDocument();
  });

  it("supports keyboard opening and Escape closing of the secondary menu", async () => {
    renderShell("/virtual-library");
    const trigger = screen.getByRole("link", { name: "藏书楼" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("link", { name: "3D 书库" })).toHaveAttribute("aria-current", "page");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });

  it("marks the active knowledge graph tab and hides chrome when entering the immersive 3D route on mobile", () => {
    mockMobileViewport(true);
    renderShell("/knowledge-graph");
    const subNav = screen.getByRole("navigation", { name: "分区导航" });
    const graph = within(subNav).getByRole("link", { name: "知识图谱" });
    expect(graph).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(subNav).getByRole("link", { name: "3D 书库" }));
    expect(screen.getByTestId("search-route")).toHaveTextContent("/virtual-library");
    expect(screen.queryByRole("navigation", { name: "底部导航" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "分区导航" })).not.toBeInTheDocument();
  });

  it("keeps public discovery and enabled virtual shelves under mobile navigation while hiding private entries when signed out", () => {
    authState.signedIn = false;
    mockMobileViewport(true);
    renderShell("/library");
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();

    const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
    expect(within(bottomNav).getByRole("link", { name: "藏书" })).toBeInTheDocument();
    expect(within(bottomNav).getByRole("link", { name: "发现" })).toBeInTheDocument();
    expect(within(bottomNav).getByRole("link", { name: "3D" })).toBeInTheDocument();
    expect(within(bottomNav).queryByText("文章")).not.toBeInTheDocument();
    expect(within(bottomNav).queryByText("笔记")).not.toBeInTheDocument();
    expect(within(bottomNav).queryByText("加密库")).not.toBeInTheDocument();

    const subNav = screen.getByRole("navigation", { name: "分区导航" });
    expect(within(subNav).getAllByRole("link").map((link) => link.textContent)).toEqual(["全部藏书", "3D 书库"]);
    expect(within(subNav).queryByText("书库概览")).not.toBeInTheDocument();
    expect(within(subNav).queryByText("书单")).not.toBeInTheDocument();
    expect(within(subNav).queryByText("知识图谱")).not.toBeInTheDocument();
  });

  it("shows 发现 in desktop navigation and deduplicates mobile 书单 subnav when 发现 tab is active", async () => {
    renderShell("/discover");
    const desktopNav = screen.getByRole("navigation", { name: "全站导航" });
    const navLinks = within(desktopNav).getAllByRole("link").map((link) => link.textContent);
    expect(navLinks).toContain("发现");
    expect(navLinks.indexOf("发现")).toBeGreaterThan(navLinks.indexOf("藏书楼"));
    expect(navLinks.indexOf("发现")).toBeLessThan(navLinks.indexOf("文章"));
    expect(within(desktopNav).getByRole("link", { name: "发现" })).toHaveAttribute("aria-current", "page");

    authState.signedIn = false;
    const signedOutDesktop = renderShell("/discover");
    const signedOutLinks = within(signedOutDesktop.container).getAllByRole("link").map((link) => link.textContent);
    expect(signedOutLinks).toContain("发现");
    expect(signedOutLinks).toContain("藏书楼");
    signedOutDesktop.unmount();

    authState.signedIn = true;
    vi.mocked(vaultAccessApi.status).mockResolvedValue({ enabled: false, configured: true, bound: false, verified: false, expiresAt: 0 });
    mockMobileViewport(true);
    const mobileLibrary = renderShell("/library");
    await waitFor(() => expect(vaultAccessApi.status).toHaveBeenCalled());
    const subNav = screen.getByRole("navigation", { name: "分区导航" });
    expect(within(subNav).getAllByRole("link").map((link) => link.textContent)).toEqual(["全部藏书", "书库概览", "知识图谱", "3D 书库"]);
    mobileLibrary.unmount();

    for (const path of ["/discover", "/booklists", "/booklists/list-one", "/article-collections", "/article-collections/col-1"]) {
      const view = renderShell(path);
      const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
      expect(within(bottomNav).getByRole("link", { name: "发现" })).toHaveAttribute("aria-current", "page");
      expect(within(bottomNav).getByRole("link", { name: "藏书" })).not.toHaveAttribute("aria-current", "page");
      expect(within(bottomNav).getByRole("link", { name: "文章" })).not.toHaveAttribute("aria-current", "page");
      view.unmount();
    }
  });

  it("switches the whole site to the same night theme used by the reader", async () => {
    renderShell("/library");

    fireEvent.click(screen.getByRole("button", { name: "切换全站主题" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "夜间" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-humite-theme", "night");
      expect(screen.getByRole("button", { name: "切换全站主题" })).toHaveAttribute("aria-expanded", "false");
    });
    expect(localStorage.getItem("humite-theme-preference")).toBe("NIGHT");
  });

  it("switches back to the bright theme and closes the menu after selection", async () => {
    renderShell("/library");

    fireEvent.click(screen.getByRole("button", { name: "切换全站主题" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "明亮" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-humite-theme", "white");
      expect(screen.getByRole("button", { name: "切换全站主题" })).toHaveAttribute("aria-expanded", "false");
    });
    expect(localStorage.getItem("humite-theme-preference")).toBe("WHITE");
  });

  it("can return to following the system theme after a manual switch", async () => {
    renderShell("/library");

    fireEvent.click(screen.getByRole("button", { name: "切换全站主题" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "夜间" }));
    expect(localStorage.getItem("humite-theme-preference")).toBe("NIGHT");

    fireEvent.click(screen.getByRole("button", { name: "切换全站主题" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "跟随系统" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-humite-theme", "paper");
      expect(localStorage.getItem("humite-theme-preference")).toBeNull();
    });
  });
});
