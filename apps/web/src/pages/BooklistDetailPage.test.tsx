// 验证创建者编辑与拖动排序入口，避免重复的上下移动按钮。
// Checks creator editing and drag sorting without redundant up/down controls.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { demoBooks } from "../data/demo";
import { TestProviders } from "../test/TestProviders";
import { BooklistDetailPage } from "./BooklistDetailPage";

const owner = {
  id: "user-owner",
  username: "owner",
  displayName: "林",
  role: "OWNER",
  mustChangePassword: false,
};

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="booklist-location">{pathname}{search}</output>;
}

describe("BooklistDetailPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("humite-demo-session", JSON.stringify(owner));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("创建者可编辑资料，排序列表保留拖动并移除重复的上下按钮", async () => {
    render(
      <TestProviders initialPath="/booklists/booklist-private">
        <Routes><Route path="/booklists/:booklistId" element={<BooklistDetailPage />} /></Routes>
      </TestProviders>,
    );

    expect(await screen.findByRole("heading", { name: "想读的自然笔记" })).toBeInTheDocument();
    expect(screen.getByText("仅自己")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回书单" })).toHaveAttribute("href", "/discover?tab=booklists");
    expect(screen.getByRole("link", { name: "书单" })).toHaveAttribute("href", "/discover?tab=booklists");
    expect(screen.getByRole("button", { name: "编辑书单" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "整理书单" }));
    expect(await screen.findByRole("heading", { name: "整理书单 · 想读的自然笔记" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "关闭整理书单" })).toHaveLength(1);
    const currentOrder = within(await screen.findByRole("region", { name: "当前顺序" }));
    const firstTitle = demoBooks[2].title;
    expect(currentOrder.queryByRole("button", { name: /^上移|^下移/ })).not.toBeInTheDocument();
    expect(await currentOrder.findAllByRole("listitem")).toHaveLength(3);
    for (const row of currentOrder.getAllByRole("listitem")) expect(row).toHaveAttribute("draggable", "true");
    expect(currentOrder.getByRole("button", { name: `移出 ${firstTitle}` })).toBeEnabled();
  });

  it("returns to /discover?tab=booklists on back click and deletion, and preserves valid /discover return targets", async () => {
    vi.spyOn(api, "deleteBooklist").mockResolvedValue(undefined);

    const backView = render(
      <TestProviders initialPath="/booklists/booklist-private?from=%2Fdiscover">
        <Routes>
          <Route path="/booklists/:booklistId" element={<><BooklistDetailPage /><LocationProbe /></>} />
          <Route path="/discover" element={<LocationProbe />} />
        </Routes>
      </TestProviders>,
    );

    expect(await screen.findByRole("heading", { name: "想读的自然笔记" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回书单" })).toHaveAttribute("href", "/discover");
    expect(screen.getByRole("link", { name: "书单" })).toHaveAttribute("href", "/discover");
    fireEvent.click(screen.getByRole("link", { name: "返回书单" }));
    await waitFor(() => expect(screen.getByTestId("booklist-location")).toHaveTextContent(/^\/discover$/));
    backView.unmount();

    render(
      <TestProviders initialPath="/booklists/booklist-private?from=%2Fbooklists">
        <Routes>
          <Route path="/booklists/:booklistId" element={<><BooklistDetailPage /><LocationProbe /></>} />
          <Route path="/discover" element={<LocationProbe />} />
        </Routes>
      </TestProviders>,
    );

    expect(await screen.findByRole("heading", { name: "想读的自然笔记" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回书单" })).toHaveAttribute("href", "/discover?tab=booklists");
    fireEvent.click(screen.getByRole("button", { name: "编辑书单" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑书单" }, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除书单" }));
    const confirmDialog = await screen.findByRole("dialog", { name: /删除/ });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "删除书单" }));
    await waitFor(() => expect(screen.getByTestId("booklist-location")).toHaveTextContent("/discover?tab=booklists"));
  });
});
