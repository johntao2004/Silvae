// 覆盖时长输入边界、站点所有者自动保存与管理员只读，客户端输入校验不替代服务端限制。
// Covers duration bounds, owner auto-save and administrator read-only state without replacing server validation.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TestProviders } from "../test/TestProviders";
import { api } from "../api/client";
import { SessionPolicySettings } from "./SessionPolicySettings";

afterEach(() => vi.restoreAllMocks());

function identity(role: string) {
  sessionStorage.setItem("humite-demo-session", JSON.stringify({
    id: "manager", username: "manager", role, displayName: "管理者", mustChangePassword: false,
  }));
}

it("validates bounds and auto-saves owner changes on blur without a save button", async () => {
  identity("OWNER");
  vi.spyOn(api, "sessionPolicy").mockResolvedValue({ maxMinutes: 1440 });
  const save = vi.spyOn(api, "saveSessionPolicy").mockResolvedValue({ maxMinutes: 60 });
  render(<TestProviders><SessionPolicySettings /></TestProviders>);

  const field = await screen.findByRole("spinbutton", { name: "最长登录时长（分钟）" });
  expect(field.closest(".bk-settings-card")).not.toBeNull();
  expect(screen.queryByRole("button", { name: /保存/ })).not.toBeInTheDocument();

  fireEvent.change(field, { target: { value: "1" } });
  fireEvent.blur(field);
  expect(await screen.findByRole("alert")).toHaveTextContent("请输入 5–43200 分钟的整数。");
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: "60" } });
  fireEvent.blur(field);
  await waitFor(() => expect(save).toHaveBeenCalledWith(60));
  expect(await screen.findByRole("status")).toHaveTextContent("已自动保存");
});

it("debounces owner changes and saves automatically without blur", async () => {
  identity("OWNER");
  vi.spyOn(api, "sessionPolicy").mockResolvedValue({ maxMinutes: 1440 });
  const save = vi.spyOn(api, "saveSessionPolicy").mockResolvedValue({ maxMinutes: 120 });
  render(<TestProviders><SessionPolicySettings /></TestProviders>);

  const field = await screen.findByRole("spinbutton", { name: "最长登录时长（分钟）" });
  fireEvent.change(field, { target: { value: "120" } });
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(save).toHaveBeenCalledWith(120), { timeout: 1500 });
  expect(await screen.findByRole("status")).toHaveTextContent("已自动保存");
});

it("keeps administrator policy controls read-only", async () => {
  identity("ADMIN");
  vi.spyOn(api, "sessionPolicy").mockResolvedValue({ maxMinutes: 1440 });
  render(<TestProviders><SessionPolicySettings /></TestProviders>);
  expect(await screen.findByRole("spinbutton", { name: "最长登录时长（分钟）" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /保存/ })).not.toBeInTheDocument();
});