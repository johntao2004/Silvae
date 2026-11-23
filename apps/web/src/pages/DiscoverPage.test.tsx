import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { PermissionBoundary, defaultGrants } from "../auth/permissions";
import type { BooklistSummary } from "../domain/types";
import {
  articleCollections,
  type ArticleCollectionDetail,
  type ArticleCollectionSummary,
} from "../features/article-collections/api";
import { TestProviders } from "../test/TestProviders";
import { ArticleCollectionDetailPage } from "./ArticleCollectionDetailPage";
import { DiscoverPage } from "./DiscoverPage";

const owner = {
  id: "user-owner",
  username: "owner",
  displayName: "林",
  role: "OWNER",
  mustChangePassword: false,
};

const member = {
  id: "user-member",
  username: "member",
  displayName: "成员",
  role: "MEMBER",
  mustChangePassword: false,
};

function makeBooklist(id: string, title: string, visibility: BooklistSummary["visibility"], ownedByViewer: boolean): BooklistSummary {
  return {
    id,
    title,
    description: `${title}说明`,
    kind: "PERSONAL",
    visibility,
    ownerDisplayName: "林",
    bookCount: 3,
    previewBooks: [],
    ownedByViewer,
    editable: ownedByViewer,
    revision: 1,
    hiddenPublicBookCount: 0,
    updatedAt: "2026-08-21T03:00:00Z",
  };
}

function makeCollection(id: string, title: string, visibility: ArticleCollectionSummary["visibility"], ownedByViewer: boolean): ArticleCollectionSummary {
  return {
    id,
    title,
    description: `${title}简介`,
    visibility,
    ownerDisplayName: ownedByViewer ? "林" : "书友",
    ownedByViewer,
    editable: ownedByViewer,
    articleCount: 4,
    previewArticles: [],
    revision: 1,
    createdAt: "2026-08-21T03:00:00Z",
    updatedAt: "2026-08-21T03:00:00Z",
  };
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="discover-location">{pathname}{search}</output>;
}

describe("DiscoverPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows only public booklists and omits article collection tabs/actions when signed out", async () => {
    const publicList = makeBooklist("pub-1", "公开好书", "PUBLIC", false);
    vi.spyOn(api, "listBooklists").mockResolvedValue({ items: [publicList] });
    const collectionsSpy = vi.spyOn(articleCollections, "list");

    render(
      <TestProviders initialPath="/discover?tab=collections">
        <DiscoverPage />
      </TestProviders>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "发现" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "公开书单" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "公开好书" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "我的书单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "家庭共享" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "我的私密合集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "成员共享合集" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "书单" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "文章合集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建书单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建合集" })).not.toBeInTheDocument();
    expect(collectionsSpy).not.toHaveBeenCalled();
  });

  it("shows merged booklist and article collection sections when signed in", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(owner));
    const myBooklist = makeBooklist("my-bl", "夜间枕边书", "PRIVATE", true);
    const familyBooklist = makeBooklist("fam-bl", "周末共读书单", "MEMBERS", false);
    const publicBooklist = makeBooklist("pub-bl", "编辑推荐", "PUBLIC", false);
    const privateCollection = makeCollection("my-col", "私密文章集", "PRIVATE", true);
    const sharedCollection = makeCollection("shared-col", "馆友共读集", "MEMBERS", false);

    vi.spyOn(api, "listBooklists").mockResolvedValue({ items: [myBooklist, familyBooklist, publicBooklist] });
    vi.spyOn(articleCollections, "list").mockResolvedValue({ items: [privateCollection, sharedCollection] });

    render(
      <TestProviders initialPath="/discover">
        <DiscoverPage />
      </TestProviders>,
    );

    expect(await screen.findByRole("heading", { name: "我的书单" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "家庭共享" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "公开书单" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "我的私密合集" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "成员共享合集" })).toBeInTheDocument();

    expect(screen.getByText("夜间枕边书")).toBeInTheDocument();
    expect(screen.getByText("周末共读书单")).toBeInTheDocument();
    expect(screen.getByText("编辑推荐")).toBeInTheDocument();
    expect(screen.getByText("私密文章集")).toBeInTheDocument();
    expect(screen.getByText("馆友共读集")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "新建书单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建合集" })).toBeInTheDocument();

    const collectionLists = screen.getAllByRole("region", { name: "合集列表" });
    expect(collectionLists[0]).not.toHaveTextContent("篇文章");
    expect(collectionLists[0]).not.toHaveTextContent("仅自己可见");
    expect(collectionLists[1]).not.toHaveTextContent("篇文章");
    expect(collectionLists[1]).not.toHaveTextContent("书库成员可见");

    for (const cover of [
      screen.getByRole("img", { name: "夜间枕边书书单封面" }),
      screen.getByRole("img", { name: "周末共读书单书单封面" }),
      screen.getByRole("img", { name: "编辑推荐书单封面" }),
      screen.getByRole("img", { name: "私密文章集文章封面预览" }),
      screen.getByRole("img", { name: "馆友共读集文章封面预览" }),
    ]) {
      expect(getComputedStyle(cover).aspectRatio).toBe("1 / 1");
    }
  });

  it("switches between 全部, 书单, and 文章合集 tabs and persists selection in ?tab=", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(owner));
    vi.spyOn(api, "listBooklists").mockResolvedValue({
      items: [makeBooklist("pub-bl", "公共书单卡", "PUBLIC", false)],
    });
    vi.spyOn(articleCollections, "list").mockResolvedValue({
      items: [makeCollection("shared-col", "公共文章合集卡", "MEMBERS", false)],
    });

    render(
      <TestProviders initialPath="/discover">
        <DiscoverPage />
        <LocationProbe />
      </TestProviders>,
    );

    expect(await screen.findByText("公共书单卡")).toBeInTheDocument();
    expect(screen.getByText("公共文章合集卡")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "书单" }));
    expect(screen.getByTestId("discover-location")).toHaveTextContent("/discover?tab=booklists");
    expect(screen.getByRole("tab", { name: "书单" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("公共书单卡")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "我的私密合集" })).not.toBeInTheDocument();
    expect(screen.queryByText("公共文章合集卡")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "文章合集" }));
    expect(screen.getByTestId("discover-location")).toHaveTextContent("/discover?tab=collections");
    expect(screen.getByRole("tab", { name: "文章合集" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("公共文章合集卡")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "公开书单" })).not.toBeInTheDocument();
    expect(screen.queryByText("公共书单卡")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    expect(screen.getByTestId("discover-location")).toHaveTextContent(/^\/discover$/);
    expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("公共书单卡")).toBeInTheDocument();
    expect(screen.getByText("公共文章合集卡")).toBeInTheDocument();
  });

  it("respects collection-only view permissions when booklists.view is revoked", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    sessionStorage.setItem(
      "humite-demo-role-permissions",
      JSON.stringify({
        revision: 1,
        grants: {
          OWNER: defaultGrants("OWNER"),
          ADMIN: defaultGrants("ADMIN"),
          MEMBER: defaultGrants("MEMBER").filter((code) => code !== "booklists.view" && code !== "booklists.edit"),
        },
      }),
    );

    const listBooklistsSpy = vi.spyOn(api, "listBooklists");
    vi.spyOn(articleCollections, "list").mockResolvedValue({
      items: [makeCollection("col-1", "仅合集可见", "PRIVATE", true)],
    });

    render(
      <TestProviders initialPath="/discover?tab=collections">
        <DiscoverPage />
      </TestProviders>,
    );

    expect(await screen.findByText("仅合集可见")).toBeInTheDocument();
    expect(listBooklistsSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("tab", { name: "书单" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文章合集" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "新建书单" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建合集" })).toBeInTheDocument();
  });

  it("opens BooklistFormDialog and ArticleCollectionFormDialog from header actions", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(owner));
    vi.spyOn(api, "listBooklists").mockResolvedValue({ items: [] });
    vi.spyOn(articleCollections, "list").mockResolvedValue({ items: [] });
    const createdBooklist: BooklistSummary = makeBooklist("new-bl", "新书单", "PRIVATE", true);
    const createBooklistSpy = vi.spyOn(api, "createBooklist").mockResolvedValue(createdBooklist);
    const createdCollection: ArticleCollectionDetail = {
      ...makeCollection("new-col", "新文章合集", "PRIVATE", true),
      articles: [],
    };
    const createCollectionSpy = vi.spyOn(articleCollections, "create").mockResolvedValue(createdCollection);

    render(
      <TestProviders initialPath="/discover">
        <Routes>
          <Route path="/discover" element={<><DiscoverPage /><LocationProbe /></>} />
          <Route path="/article-collections/:collectionId" element={<LocationProbe />} />
        </Routes>
      </TestProviders>,
    );

    await screen.findByRole("heading", { name: "公开书单" });

    fireEvent.click(screen.getByRole("button", { name: "新建书单" }));
    const booklistDialog = await screen.findByRole("dialog", { name: "新建书单" }, { timeout: 5000 });
    fireEvent.change(within(booklistDialog).getByLabelText("书单名称"), { target: { value: "新书单" } });
    fireEvent.click(within(booklistDialog).getByRole("button", { name: "创建书单" }));
    await waitFor(() => expect(createBooklistSpy).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "新建合集" }));
    const collectionDialog = await screen.findByRole("dialog", { name: "新建合集" }, { timeout: 5000 });
    fireEvent.change(within(collectionDialog).getByLabelText("合集名称"), { target: { value: "新文章合集" } });
    fireEvent.click(within(collectionDialog).getByRole("button", { name: "创建合集" }));
    await waitFor(() => expect(createCollectionSpy).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByTestId("discover-location")).toHaveTextContent("/article-collections/new-col?from=%2Fdiscover"),
    );
  });

  it("enforces /discover permission boundary for booklists.view or articles.collections.view", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    sessionStorage.setItem(
      "humite-demo-role-permissions",
      JSON.stringify({
        revision: 1,
        grants: {
          OWNER: defaultGrants("OWNER"),
          ADMIN: defaultGrants("ADMIN"),
          MEMBER: defaultGrants("MEMBER").filter(
            (code) => code !== "booklists.view" && code !== "articles.collections.view",
          ),
        },
      }),
    );

    const listBooklistsSpy = vi.spyOn(api, "listBooklists");
    const listCollectionsSpy = vi.spyOn(articleCollections, "list");

    const { unmount } = render(
      <TestProviders initialPath="/discover">
        <PermissionBoundary>
          <DiscoverPage />
        </PermissionBoundary>
      </TestProviders>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "403" })).toBeInTheDocument();
    expect(listBooklistsSpy).not.toHaveBeenCalled();
    expect(listCollectionsSpy).not.toHaveBeenCalled();
    unmount();

    sessionStorage.setItem(
      "humite-demo-role-permissions",
      JSON.stringify({
        revision: 2,
        grants: {
          OWNER: defaultGrants("OWNER"),
          ADMIN: defaultGrants("ADMIN"),
          MEMBER: defaultGrants("MEMBER").filter((code) => code !== "booklists.view"),
        },
      }),
    );
    listCollectionsSpy.mockResolvedValue({ items: [] });

    render(
      <TestProviders initialPath="/discover">
        <PermissionBoundary>
          <DiscoverPage />
        </PermissionBoundary>
      </TestProviders>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "发现" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "我的私密合集" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建书单" })).not.toBeInTheDocument();
    expect(listBooklistsSpy).not.toHaveBeenCalled();
  });

  it("shows merged public booklists from demo fixtures when signed out without official sections", async () => {
    render(
      <TestProviders initialPath="/discover">
        <DiscoverPage />
      </TestProviders>,
    );

    expect(await screen.findByRole("heading", { name: "公开书单" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "官方书单" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "秋日慢读" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "灯塔与远方" })).toBeInTheDocument();
  });

  it("retains per-section empty states and separates private, family, and public booklists in order", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(owner));
    vi.spyOn(articleCollections, "list").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listBooklists").mockResolvedValueOnce({ items: [] });

    const emptyView = render(
      <TestProviders initialPath="/discover?tab=booklists">
        <DiscoverPage />
      </TestProviders>,
    );
    expect(await screen.findByRole("heading", { name: "我的书单" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "家庭共享" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "公开书单" })).toBeInTheDocument();
    expect(screen.getByText("暂无书单")).toBeInTheDocument();
    expect(screen.getByText("暂无家庭共享书单")).toBeInTheDocument();
    expect(screen.getByText("暂无公开书单")).toBeInTheDocument();
    expect(screen.queryByText(/试试书单名称|创建一份个人书单|登录后可以创建/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建书单" })).toHaveLength(1);
    emptyView.unmount();

    const mine = makeBooklist("mine", "仅自己可见", "PRIVATE", true);
    const privateOther = makeBooklist("other-private", "他人的私人书单", "PRIVATE", false);
    const family = makeBooklist("fam", "我的家庭书单", "MEMBERS", true);
    const publicList = makeBooklist("pub", "我的公开书单", "PUBLIC", true);
    const otherFamily = makeBooklist("other-fam", "他人的家庭书单", "MEMBERS", false);
    const otherPublic = makeBooklist("other-pub", "他人的公开书单", "PUBLIC", false);
    vi.spyOn(api, "listBooklists").mockResolvedValue({ items: [mine, privateOther, family, publicList, otherFamily, otherPublic] });

    render(
      <TestProviders initialPath="/discover?tab=booklists">
        <DiscoverPage />
      </TestProviders>,
    );

    const sectionOrder = (await screen.findAllByRole("region")).map((section) => section.getAttribute("aria-label"));
    expect(sectionOrder).toEqual(["我的书单", "家庭共享", "公开书单"]);
    const personalSection = within(screen.getByRole("region", { name: "我的书单" }));
    const sharedSection = within(screen.getByRole("region", { name: "家庭共享" }));
    const publicSection = within(screen.getByRole("region", { name: "公开书单" }));
    expect(personalSection.getByRole("heading", { name: mine.title })).toBeInTheDocument();
    expect(personalSection.queryByRole("heading", { name: privateOther.title })).not.toBeInTheDocument();
    expect(sharedSection.getByRole("heading", { name: family.title })).toBeInTheDocument();
    expect(sharedSection.getByRole("heading", { name: otherFamily.title })).toBeInTheDocument();
    expect(publicSection.getByRole("heading", { name: publicList.title })).toBeInTheDocument();
    expect(publicSection.getByRole("heading", { name: otherPublic.title })).toBeInTheDocument();
    expect(personalSection.queryByRole("heading", { name: family.title })).not.toBeInTheDocument();
    expect(publicSection.queryByRole("heading", { name: mine.title })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建书单" }));
    expect(await screen.findByRole("dialog", { name: "新建书单" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "书单类型" })).not.toBeInTheDocument();
  });

  it("groups owned shared collections only under 成员共享合集 and round-trips to /discover?tab=collections", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    const article = {
      id: "article-1",
      title: "海边读书",
      author: "作者甲",
      source_url: "https://example.test",
      published_at: "",
      visibility: "PUBLIC" as const,
      tags: "阅读",
      cover_url: null,
      excerpt: "读书与海",
      created_at: "",
      updated_at: "",
    };
    const ownPrivate = makeCollection("own-private", "我的周末", "PRIVATE", true);
    const ownShared = makeCollection("own-shared", "我分享的合集", "MEMBERS", true);
    const otherShared = makeCollection("other-shared", "书库共读", "MEMBERS", false);
    const detail: ArticleCollectionDetail = { ...ownPrivate, articles: [article] };

    vi.spyOn(api, "listBooklists").mockResolvedValue({ items: [] });
    vi.spyOn(articleCollections, "list").mockResolvedValue({ items: [ownPrivate, ownShared, otherShared] });
    vi.spyOn(articleCollections, "get").mockResolvedValue(detail);

    render(
      <TestProviders initialPath="/discover?tab=collections&sort=updated">
        <Routes>
          <Route path="/discover" element={<><DiscoverPage /><LocationProbe /></>} />
          <Route path="/article-collections/:collectionId" element={<><ArticleCollectionDetailPage /><LocationProbe /></>} />
        </Routes>
      </TestProviders>,
    );

    const mineHeading = await screen.findByRole("heading", { name: "我的私密合集" });
    const sharedHeading = screen.getByRole("heading", { name: "成员共享合集" });
    expect(within(mineHeading.parentElement!.parentElement!).queryByText("我分享的合集")).not.toBeInTheDocument();
    expect(within(sharedHeading.parentElement!.parentElement!).getByText("我分享的合集")).toBeInTheDocument();
    expect(screen.getAllByText("我分享的合集")).toHaveLength(1);

    fireEvent.click(screen.getByRole("link", { name: /我的周末/ }));
    expect(await screen.findByRole("heading", { name: "我的周末" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("discover-location")).toHaveTextContent(
        "/article-collections/own-private?from=%2Fdiscover%3Ftab%3Dcollections%26sort%3Dupdated",
      ),
    );
    expect(screen.getByRole("button", { name: "管理文章" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑合集" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "海边读书更多操作" }));
    expect(await screen.findByRole("menuitem", { name: "打开文章" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /编辑文章/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "返回合集列表" }));
    await waitFor(() =>
      expect(screen.getByTestId("discover-location")).toHaveTextContent("/discover?tab=collections&sort=updated"),
    );
  });

  it("supports collection detail q filtering and falls back to /discover?tab=collections on unsafe or empty return targets", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    const article = {
      id: "article-1",
      title: "海边读书",
      author: "作者甲",
      source_url: "https://example.test",
      published_at: "",
      visibility: "PUBLIC" as const,
      tags: "阅读",
      cover_url: null,
      excerpt: "读书与海",
      created_at: "",
      updated_at: "",
    };
    const ownDetail: ArticleCollectionDetail = { ...makeCollection("own-collection", "我的周末", "PRIVATE", true), articles: [article] };
    vi.spyOn(articleCollections, "get").mockResolvedValue(ownDetail);

    render(
      <TestProviders initialPath="/article-collections/own-collection?q=不匹配&from=%2Farticle-collections">
        <Routes>
          <Route path="/article-collections/:collectionId" element={<><ArticleCollectionDetailPage /><LocationProbe /></>} />
        </Routes>
      </TestProviders>,
    );

    expect(await screen.findByText("没有找到匹配的文章")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回合集列表" })).toHaveAttribute("href", "/discover?tab=collections");
    expect(screen.getByRole("link", { name: "合集" })).toHaveAttribute("href", "/discover?tab=collections");
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(await screen.findByRole("region", { name: "合集文章列表" })).toHaveTextContent("海边读书");
    expect(screen.getByTestId("discover-location")).toHaveTextContent(/^\/article-collections\/own-collection\?from=%2Farticle-collections$/);
  });

  it("blocks /discover when only articles.view is granted without booklist or collection permissions", async () => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify(member));
    sessionStorage.setItem(
      "humite-demo-role-permissions",
      JSON.stringify({
        revision: 1,
        grants: {
          OWNER: defaultGrants("OWNER"),
          ADMIN: defaultGrants("ADMIN"),
          MEMBER: ["articles.view"],
        },
      }),
    );

    const listBooklistsSpy = vi.spyOn(api, "listBooklists");
    const listCollectionsSpy = vi.spyOn(articleCollections, "list");

    render(
      <TestProviders initialPath="/discover">
        <PermissionBoundary>
          <DiscoverPage />
        </PermissionBoundary>
      </TestProviders>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "403" })).toBeInTheDocument();
    expect(listBooklistsSpy).not.toHaveBeenCalled();
    expect(listCollectionsSpy).not.toHaveBeenCalled();
  });
});
