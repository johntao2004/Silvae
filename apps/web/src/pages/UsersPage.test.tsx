// 验证移动用户卡片保留必要操作，去除重复权限说明不应损害可用性。
// Checks usable mobile user cards without redundant permission copy.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { api } from "../api/client";
import { TestProviders } from "../test/TestProviders";
import { UsersPage } from "./UsersPage";

describe("UsersPage", () => {
  beforeEach(() => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({
      id: "user-owner", username: "owner", displayName: "林", role: "OWNER", mustChangePassword: false,
    }));
  });

  afterEach(() => vi.restoreAllMocks());

  it("provides a mobile user-card list without the redundant permission notes", async () => {
    render(<TestProviders initialPath="/admin/users"><UsersPage /></TestProviders>);

    expect(await screen.findByRole("region", { name: "移动端用户列表" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByText("账户状态")).toHaveLength(3);
    expect(screen.getAllByText("共 3 条").length).toBeGreaterThanOrEqual(1);
    const mobileList = screen.getByRole("region", { name: "移动端用户列表" });
    const resetButtons = within(mobileList).getAllByRole("button", { name: "临时密码" });
    const revokeButtons = within(mobileList).getAllByRole("button", { name: "退出全部会话" });
    expect(resetButtons[0].parentElement).toBe(revokeButtons[0].parentElement);
    expect(getComputedStyle(resetButtons[0].parentElement!).flexDirection).toBe("row");
    expect(resetButtons[0]).not.toHaveClass("ant-btn-sm");
    expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
    expect(screen.queryByText("浏览、阅读、书签、划线和私人笔记。")).not.toBeInTheDocument();
    expect(screen.queryByText("再加用户、扫描书库、管理 NAS 文件。")).not.toBeInTheDocument();
    expect(screen.queryByText("立即撤销会话，保留其个人阅读数据。")).not.toBeInTheDocument();
  });

  it("paginates users at 5 items per page by default with concise total text", async () => {
    vi.spyOn(api, "listUsers").mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        id: `u-${index + 1}`,
        username: `user${index + 1}`,
        displayName: `用户 ${index + 1}`,
        role: index === 0 ? "OWNER" : "MEMBER",
        status: "ACTIVE",
        mustChangePassword: false,
        createdAt: "2026-10-01T00:00:00Z",
      })),
    );
    render(<TestProviders initialPath="/admin/users"><UsersPage /></TestProviders>);

    const mobileList = await screen.findByRole("region", { name: "移动端用户列表" });
    expect(within(mobileList).getAllByRole("article")).toHaveLength(5);
    expect(within(mobileList).queryByText("用户 6")).not.toBeInTheDocument();
    expect(within(mobileList).getByText("共 6 条")).toBeInTheDocument();
    expect(screen.queryByText(/第 1–/)).not.toBeInTheDocument();

    fireEvent.click(within(mobileList).getByTitle("2"));
    expect(within(mobileList).getAllByRole("article")).toHaveLength(1);
    expect(within(mobileList).getByText("用户 6")).toBeInTheDocument();
  });
});
