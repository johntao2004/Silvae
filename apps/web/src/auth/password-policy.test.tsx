// 覆盖共享规则提示、提交前拒绝与设置保存，保持 ASCII 符号和长度规则一致。
// Covers shared rule feedback, pre-submit rejection and settings persistence with consistent ASCII-symbol and length rules.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { passwordRequirements } from "./password-policy";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { PasswordPolicySettings } from "../pages/PasswordPolicySettings";
import { Route, Routes } from "react-router-dom";
import { TestProviders } from "../test/TestProviders";
import { api } from "../api/client";
const change=vi.fn();
const user = { role: "OWNER", mustChangePassword: false, canChangePasswordWithoutCurrent: false };
vi.mock("./AuthContext", async original=>({...await original<object>(),useAuth:()=>({user,changePassword:change})}));
const strict={minLength:12,requireUppercase:true,requireLowercase:true,requireDigit:true,requireSpecial:true};
afterEach(()=>{
  vi.restoreAllMocks();
  change.mockReset();
  user.mustChangePassword = false;
  user.canChangePasswordWithoutCurrent = false;
});
it("checks enabled rules consistently including ASCII symbols",()=>{
 expect(passwordRequirements(strict,"Strong-Password1!").every(r=>r.met)).toBe(true);
 expect(passwordRequirements(strict,"aaaaaaaaaaaa").filter(r=>!r.met)).toHaveLength(3);
 expect(passwordRequirements(strict,"A1中文中文中文中文中文a").at(-1)?.met).toBe(false);
});
it("displays rules before submission and rejects weak passwords without native popup",async()=>{
 vi.spyOn(api,"passwordPolicy").mockResolvedValue(strict);
 render(<TestProviders><ChangePasswordPage /></TestProviders>);
 expect(await screen.findByText("长度为 12–64 个字符")).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText("当前密码"),{target:{value:"Previous-Password1!"}});
 fireEvent.change(screen.getByLabelText("新密码"),{target:{value:"abcdef"}});
 fireEvent.change(screen.getByLabelText("确认新密码"),{target:{value:"abcdef"}});
 expect(screen.getByText("未满足：包含大写字母 A–Z")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"保存密码"}));
 expect(change).not.toHaveBeenCalled();
 expect(screen.getByLabelText("新密码").closest("form")).toHaveAttribute("novalidate");
});
it("sets a new password after a verified temporary login and enters the library", async () => {
  user.mustChangePassword = true;
  user.canChangePasswordWithoutCurrent = true;
  vi.spyOn(api, "passwordPolicy").mockResolvedValue({ minLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecial: false });
  change.mockResolvedValue(undefined);
  render(<TestProviders initialPath="/change-password"><Routes>
    <Route path="/change-password" element={<ChangePasswordPage />} />
    <Route path="/library" element={<p>已进入书库</p>} />
  </Routes></TestProviders>);

  expect(screen.queryByLabelText("当前临时密码")).not.toBeInTheDocument();
  expect(screen.getByLabelText("新密码")).toHaveFocus();
  await screen.findByText("长度为 8–64 个字符");
  const overLimit = "x".repeat(65);
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: overLimit } });
  fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: overLimit } });
  fireEvent.click(screen.getByRole("button", { name: "保存后进书库" }));
  expect(screen.getByText("未满足：长度为 8–64 个字符")).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "river007" } });
  fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "river008" } });
  fireEvent.click(screen.getByRole("button", { name: "保存后进书库" }));
  expect(await screen.findByText("两次输入的新密码不一致")).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "river007" } });
  fireEvent.click(screen.getByRole("button", { name: "保存后进书库" }));
  expect(await screen.findByText("已进入书库")).toBeInTheDocument();
  expect(change).toHaveBeenCalledWith({ newPassword: "river007" });
});
it("requires the current password for ordinary profile changes", async () => {
  vi.spyOn(api, "passwordPolicy").mockResolvedValue(strict);
  change.mockResolvedValue(undefined);
  render(<TestProviders><ChangePasswordPage embedded /></TestProviders>);
  await screen.findByText("长度为 12–64 个字符");
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "Strong-Password1!" } });
  fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "Strong-Password1!" } });
  const save = screen.getByRole("button", { name: "保存密码" });
  fireEvent.click(save);
  expect(await screen.findByText("请输入当前密码。")).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();

  const currentPassword = "Previous-Password1!".repeat(4);
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: currentPassword } });
  fireEvent.click(save);
  expect(await screen.findByText("登录密码已更新。")).toBeInTheDocument();
  expect(change).toHaveBeenCalledWith({ currentPassword, newPassword: "Strong-Password1!" });
});
it("auto-saves complexity switches immediately and validates minLength without a save button", async () => {
  user.role = "OWNER";
  vi.spyOn(api, "passwordPolicy").mockResolvedValue(strict);
  const save = vi.spyOn(api, "savePasswordPolicy").mockResolvedValue({ ...strict, minLength: 16, requireDigit: false });
  render(<TestProviders><PasswordPolicySettings /></TestProviders>);

  const lengthField = await screen.findByLabelText("密码最小长度");
  expect(lengthField.closest(".bk-settings-card")).not.toBeNull();
  expect(screen.queryByRole("button", { name: /保存/ })).not.toBeInTheDocument();

  fireEvent.change(lengthField, { target: { value: "4" } });
  fireEvent.blur(lengthField);
  expect(await screen.findByRole("alert")).toHaveTextContent("最小长度需为 8–64 的整数。");
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(lengthField, { target: { value: "16" } });
  fireEvent.click(screen.getByRole("switch", { name: "要求数字" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...strict, minLength: 16, requireDigit: false }));
  expect(await screen.findByRole("status")).toHaveTextContent("已自动保存");
});
