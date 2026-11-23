// 验证自动保存后品牌、元信息与页脚同步刷新，并检验必填项校验。
// Checks auto-saved personalization refreshes brand, metadata and footer, plus required-field validation.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, DEFAULT_SITE_SETTINGS } from "../api/client";
import { TestProviders } from "../test/TestProviders";
import { AppShell } from "../components/AppShell";
import { SiteSettingsPage } from "./SiteSettingsPage";

afterEach(() => vi.restoreAllMocks());

it("auto-saves personalization and immediately updates site brand, metadata and footer", async () => {
  sessionStorage.setItem("humite-demo-session", JSON.stringify({
    id: "owner", username: "owner", displayName: "站点所有者", role: "OWNER", mustChangePassword: false,
  }));
  vi.spyOn(api, "siteSettings").mockResolvedValue({ ...DEFAULT_SITE_SETTINGS });
  const save = vi.spyOn(api, "saveSiteSettings").mockImplementation(async (input) => ({ ...input }));
  render(<TestProviders initialPath="/settings#personalization"><AppShell><SiteSettingsPage /></AppShell></TestProviders>);

  const nameField = await screen.findByRole("textbox", { name: "网站名称" });
  expect(nameField.closest(".bk-settings-stack")).not.toBeNull();
  expect(nameField.closest(".bk-settings-card")).not.toBeNull();
  expect(nameField.closest(".bk-settings-field-grid")).not.toBeNull();
  expect(screen.getByRole("textbox", { name: "网站简介" }).closest(".bk-settings-field-full")).not.toBeNull();
  expect(screen.getByRole("switch", { name: "启用3D 书库" }).closest(".bk-settings-toggle-row")).not.toBeNull();
  expect(screen.getByRole("switch", { name: "允许搜索引擎收录" }).closest(".bk-settings-toggle-row")).not.toBeNull();
  expect(screen.queryByRole("button", { name: /保存/ })).not.toBeInTheDocument();

  fireEvent.change(nameField, { target: { value: "山间书屋" } });
  fireEvent.change(screen.getByRole("textbox", { name: "版权说明" }), { target: { value: "山间书屋 版权所有" } });
  fireEvent.click(screen.getByRole("switch", { name: "启用3D 书库" }));

  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    name: "山间书屋",
    copyright: "山间书屋 版权所有",
    allowIndexing: false,
    virtualLibraryEnabled: false,
  })));
  expect(await screen.findByRole("status")).toHaveTextContent("已自动保存");
  expect(screen.getByRole("switch", { name: "启用3D 书库" })).not.toBeChecked();
  expect(await screen.findByRole("link", { name: "山间书屋" })).toBeInTheDocument();
  expect(await screen.findByText("山间书屋 版权所有")).toBeInTheDocument();
  await waitFor(() => expect(document.title).toBe("山间书屋 · 电子图书馆"));
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

it("skips auto-saving when site name is blank and saves on blur once valid", async () => {
  sessionStorage.setItem("humite-demo-session", JSON.stringify({
    id: "owner", username: "owner", displayName: "站点所有者", role: "OWNER", mustChangePassword: false,
  }));
  vi.spyOn(api, "siteSettings").mockResolvedValue({ ...DEFAULT_SITE_SETTINGS });
  const save = vi.spyOn(api, "saveSiteSettings").mockImplementation(async (input) => ({ ...input }));
  render(<TestProviders><SiteSettingsPage /></TestProviders>);

  const nameField = await screen.findByRole("textbox", { name: "网站名称" });
  fireEvent.change(nameField, { target: { value: "   " } });
  fireEvent.blur(nameField);
  expect(await screen.findByRole("alert")).toHaveTextContent("请填写网站名称。");
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(nameField, { target: { value: "清风书屋" } });
  fireEvent.blur(nameField);
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "清风书屋" })));
  expect(await screen.findByRole("status")).toHaveTextContent("已自动保存");
});