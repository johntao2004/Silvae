// 覆盖真实/演示登录边界、初始化与注册入口条件，问候辅助函数测试不代表页面显示问候。
// Covers real/demo login boundaries and setup/signup availability; greeting-helper tests do not imply visible greeting copy.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, vi } from "vitest";
import { api } from "../api/client";
import { TestProviders } from "../test/TestProviders";
import { getLoginDefaults, LoginPage } from "./LoginPage";

describe("LoginPage", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])("redirects an existing session on /login/ (temporary=%s)", async (temporary) => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({id:"entry-test",username:"owner",displayName:"Owner",role:"OWNER",mustChangePassword:temporary}));
    render(<TestProviders initialPath="/login/"><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/library" element={<div>已进入首页</div>} />
      <Route path="/change-password" element={<div>需要首次改密</div>} />
    </Routes></TestProviders>);
    expect(await screen.findByText(temporary ? "需要首次改密" : "已进入首页")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/^登录$/})).not.toBeInTheDocument();
  });

  it("never invents a database password outside demo mode", () => {
    expect(getLoginDefaults(false)).toEqual({
      username: "",
      password: "",
      hint: "",
    });
    expect(getLoginDefaults(true).password).toBe("humite-demo");
  });

  it("logs into the demo owner account", async () => {
    render(
      <TestProviders initialPath="/login">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/library" element={<div>书库已打开</div>} />
        </Routes>
      </TestProviders>,
    );

    expect(screen.queryByText("登录后继续阅读、整理藏书，或管理家庭成员。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(screen.getByText("书库已打开")).toBeInTheDocument());
    expect(sessionStorage.getItem("humite-demo-session")).toContain('"role":"OWNER"');
  });

  it("does not offer owner initialization after setup has completed", async () => {
    vi.spyOn(api, "getSetupStatus").mockResolvedValue({ initialized: true });

    render(<TestProviders initialPath="/login"><LoginPage /></TestProviders>);

    await waitFor(() => expect(api.getSetupStatus).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "初始化主人账户" })).not.toBeInTheDocument();
  });

  it("offers owner initialization only when setup is still required", async () => {
    vi.spyOn(api, "getSetupStatus").mockResolvedValue({ initialized: false });

    render(<TestProviders initialPath="/login"><LoginPage /></TestProviders>);

    expect(await screen.findByRole("link", { name: "初始化主人账户" })).toHaveAttribute("href", "/setup");
  });
  it("offers registration when enabled and always provides a return route", async () => {
    vi.spyOn(api, "registrationStatus").mockResolvedValue({ registrationEnabled: true });
    render(<TestProviders initialPath="/login"><LoginPage /></TestProviders>);
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/library");
    expect(await screen.findByRole("link", { name: "注册账户" })).toHaveAttribute("href", "/register");
  });
});
