// 验证 SMTP 自动保存、保留密钥及恢复链接确认，密码不一致时不得发送重置请求。
// Checks SMTP auto-save/secret preservation and recovery-link confirmation, with no reset request on mismatched passwords.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { TestProviders } from "../test/TestProviders";
import { MailSettingsPage } from "./MailSettingsPage";
import { RecoveryPage } from "./RecoveryPage";

afterEach(() => vi.restoreAllMocks());

it("auto-saves SMTP before enabling test delivery and preserves a saved secret", async () => {
  sessionStorage.setItem("humite-demo-session", JSON.stringify({
    id: "owner", username: "owner", displayName: "站点所有者", role: "OWNER", mustChangePassword: false,
  }));
  const settings = {
    enabled: true,
    host: "smtp.example.com",
    port: 587,
    security: "STARTTLS",
    username: "library",
    password: "",
    sender: "library@example.com",
    publicUrl: "https://books.example.com",
    passwordConfigured: true,
  };
  vi.spyOn(api, "mailSettings").mockResolvedValue(settings);
  const save = vi.spyOn(api, "saveMailSettings").mockResolvedValue({ ...settings, host: "smtp2.example.com" });
  const send = vi.spyOn(api, "testMail").mockResolvedValue();
  render(<TestProviders><MailSettingsPage /></TestProviders>);

  const hostInput = await screen.findByLabelText("SMTP 主机");
  expect(hostInput.closest(".bk-settings-stack")).not.toBeNull();
  expect(hostInput.closest(".bk-settings-card")).not.toBeNull();
  expect(hostInput.closest(".bk-settings-field-grid")).not.toBeNull();
  expect(screen.getByRole("switch", { name: "启用邮件服务" }).closest(".bk-settings-toggle-row")).not.toBeNull();
  expect(screen.getByRole("combobox", { name: "连接加密" }).closest(".bk-settings-field-grid")).not.toBeNull();
  expect(screen.getByLabelText("SMTP 密码或授权码").closest(".bk-settings-field-full")).not.toBeNull();
  expect(screen.queryByRole("button", { name: /^保存$/ })).not.toBeInTheDocument();

  fireEvent.change(hostInput, { target: { value: "smtp2.example.com" } });
  expect(screen.getByRole("button", { name: "发送测试" })).toBeDisabled();

  fireEvent.blur(hostInput);
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp2.example.com", password: "" })));
  expect(await screen.findByRole("status")).toHaveTextContent("已自动保存");
  await waitFor(() => expect(screen.getByRole("button", { name: "发送测试" })).toBeEnabled());

  fireEvent.change(screen.getByLabelText("测试收件邮箱"), { target: { value: "qa@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "发送测试" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith("qa@example.com"));
});

it("blocks auto-save when required mail fields are invalid", async () => {
  sessionStorage.setItem("humite-demo-session", JSON.stringify({
    id: "owner", username: "owner", displayName: "站点所有者", role: "OWNER", mustChangePassword: false,
  }));
  const settings = {
    enabled: true,
    host: "smtp.example.com",
    port: 587,
    security: "STARTTLS",
    username: "library",
    password: "",
    sender: "library@example.com",
    publicUrl: "https://books.example.com",
    passwordConfigured: true,
  };
  vi.spyOn(api, "mailSettings").mockResolvedValue(settings);
  const save = vi.spyOn(api, "saveMailSettings").mockResolvedValue(settings);
  render(<TestProviders><MailSettingsPage /></TestProviders>);

  const hostInput = await screen.findByLabelText("SMTP 主机");
  fireEvent.change(hostInput, { target: { value: "" } });
  fireEvent.blur(hostInput);
  expect(await screen.findByRole("alert")).toHaveTextContent("请检查 SMTP 主机");
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "发送测试" })).toBeDisabled();
});

it("does not consume verification links before explicit confirmation", async () => {
  const verify = vi.spyOn(api, "verifyRecoveryEmail").mockResolvedValue();
  const token = "a".repeat(43);
  render(<TestProviders initialPath={`/recover#bind=${token}`}><RecoveryPage /></TestProviders>);
  expect(verify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认绑定邮箱" }));
  await waitFor(() => expect(verify).toHaveBeenCalledWith(token));
});

it("refuses mismatched passwords without sending a reset request", async () => {
  const reset = vi.spyOn(api, "resetPassword").mockResolvedValue();
  render(<TestProviders initialPath={`/recover#reset=${"a".repeat(43)}`}><RecoveryPage /></TestProviders>);
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "A-valid-password-1" } });
  fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "A-valid-password-2" } });
  fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
  expect(reset).not.toHaveBeenCalled();
});