import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { TestProviders } from "../test/TestProviders";
import { SettingsPage } from "./SettingsPage";

const authState = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER" }));
vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: () => ({ user: { role: authState.role } }),
    RequireAuth: ({ children, roles }: { children: React.ReactNode; roles?: string[] }) =>
      roles?.includes(authState.role) ? children : <p role="alert">权限不足</p>,
  };
});
vi.mock("./UsersPage", () => ({ UsersPage: () => <p>用户面板</p> }));
vi.mock("./ActiveSessionsPage", () => ({ ActiveSessionsPage: () => <p>会话面板</p> }));
vi.mock("./LoginLogsPage", () => ({ LoginLogsPage: () => <p>登录面板</p> }));
vi.mock("./SecuritySettingsPage", () => ({ SecuritySettingsPage: () => <p>安全面板</p> }));
vi.mock("./FileOperationsPage", () => ({ FileOperationsPage: () => <p>任务面板</p> }));
vi.mock("./RecycleBinPage", () => ({ RecycleBinPage: () => <p>回收站面板</p> }));
vi.mock("./LibraryRootsPage", () => ({ LibraryRootsPage: () => <p>书库面板</p> }));
vi.mock("./ReaderFontsPage", () => ({ ReaderFontsPage: () => <p>字体面板</p> }));
vi.mock("./AiSettingsPage", () => ({ AiSettingsPage: () => <p>AI 面板</p> }));
vi.mock("./MetadataProviderSettingsPage", () => ({ MetadataProviderSettingsPage: () => <p>元数据来源面板</p> }));
vi.mock("./MailSettingsPage", () => ({ MailSettingsPage: () => <p>邮件面板</p> }));
vi.mock("./SiteSettingsPage", () => ({ SiteSettingsPage: () => <p>网站面板</p> }));

const originalMatchMedia = window.matchMedia;

function Destination() {
  const location = useLocation();
  return <output data-testid="destination">{location.pathname}{location.hash}</output>;
}

function renderSettings(initialPath: string) {
  return render(
    <TestProviders initialPath={initialPath}>
      <Routes>
        <Route path="/settings" element={<><SettingsPage /><Destination /></>} />
        <Route path="/profile" element={<Destination />} />
        <Route path="/library" element={<Destination />} />
      </Routes>
    </TestProviders>,
  );
}

beforeEach(() => {
  authState.role = "OWNER";
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(max-width: 767.95px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

it("renders grouped index navigation on mobile without tab overflow", () => {
  renderSettings("/settings");
  const nav = screen.getByRole("navigation", { name: "移动端设置导航" });
  expect(within(nav).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "馆藏与文件",
    "用户与权限",
    "登录与安全",
    "网站与阅读",
    "外部服务",
  ]);
  expect(document.querySelector(".ant-tabs-nav-more")).toBeNull();
  expect(document.querySelector(".ant-tabs")).toBeNull();
  expect(within(nav).queryByRole("button", { current: "page" })).not.toBeInTheDocument();
  expect(document.querySelector(".ant-btn-text")).toBeNull();
  expect(screen.queryByText("书库面板")).not.toBeInTheDocument();
});

it("navigates from index to metadata settings and back to index", async () => {
  renderSettings("/settings");
  fireEvent.click(screen.getByRole("button", { name: "书目信息来源" }));
  expect(await screen.findByText("元数据来源面板")).toBeInTheDocument();
  expect(screen.getByTestId("destination")).toHaveTextContent("/settings#services/metadata");
  const backButton = screen.getByRole("button", { name: "全部设置" });
  expect(backButton).toHaveTextContent("");
  expect(within(backButton).queryByText("全部设置")).not.toBeInTheDocument();
  fireEvent.click(backButton);
  expect(screen.getByRole("navigation", { name: "移动端设置导航" })).toBeInTheDocument();
  expect(screen.queryByText("元数据来源面板")).not.toBeInTheDocument();
});

it("opens deep-linked panel directly on mobile with group sibling pills", async () => {
  renderSettings("/settings#catalog/operations");
  expect(await screen.findByText("任务面板")).toBeInTheDocument();
  const backButton = screen.getByRole("button", { name: "全部设置" });
  expect(backButton).toHaveTextContent("");
  expect(within(backButton).queryByText("全部设置")).not.toBeInTheDocument();
  const siblingNav = screen.getByRole("navigation", { name: "馆藏与文件子分区" });
  expect(within(siblingNav).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "书库目录",
    "文件操作记录",
    "回收站",
  ]);
  expect(document.querySelector(".ant-tabs-nav-more")).toBeNull();
});

it("enforces permissions before rendering mobile settings index or panels", async () => {
  authState.role = "ADMIN";
  const adminView = renderSettings("/settings#services/mail");
  expect(await screen.findByRole("heading", { level: 1, name: "403" })).toBeInTheDocument();
  expect(screen.queryByText("邮件面板")).not.toBeInTheDocument();
  adminView.unmount();

  authState.role = "MEMBER";
  renderSettings("/settings");
  expect(await screen.findByRole("heading", { level: 1, name: "403" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "移动端设置导航" })).not.toBeInTheDocument();
});
