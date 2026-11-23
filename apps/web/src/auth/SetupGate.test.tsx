import { fireEvent, render, screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, vi } from "vitest";
import { api, ApiRequestError } from "../api/client";
import { LoginPage } from "../pages/LoginPage";
import { TestProviders } from "../test/TestProviders";
import { SetupGate } from "./SetupGate";
import { setupStatusQueryOptions } from "./setup-status";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.hash}</output>;
}

describe("SetupGate", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("uses a short cache without automatic retries or focus refetches", () => {
    expect(setupStatusQueryOptions.staleTime).toBe(60_000);
    expect(setupStatusQueryOptions.retry).toBe(false);
    expect(setupStatusQueryOptions.refetchOnWindowFocus).toBe(false);
  });

  it.each(["/login", "/library", "/anything-not-found"])("redirects %s to setup before initialization", async path => {
    vi.spyOn(api, "getSetupStatus").mockResolvedValue({ initialized: false });
    render(<TestProviders initialPath={path}><SetupGate><Routes><Route path="/setup" element={<div>setup</div>} /><Route path="*" element={<div>business page</div>} /></Routes></SetupGate></TestProviders>);
    expect(await screen.findByText("setup")).toBeInTheDocument();
    expect(screen.queryByText("business page")).not.toBeInTheDocument();
  });

  it("shows a request error and waits for manual retry when status cannot be fetched", async () => {
    const getSetupStatus = vi.spyOn(api, "getSetupStatus")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ initialized: true });
    render(<TestProviders initialPath="/login"><SetupGate><Routes><Route path="/setup" element={<div>setup</div>} /><Route path="*" element={<div>business page</div>} /></Routes></SetupGate></TestProviders>);

    expect(await screen.findByRole("alert", { name: "错误页面" })).toBeInTheDocument();
    expect(screen.getByText("原因：offline")).toBeInTheDocument();
    expect(screen.queryByText("business page")).not.toBeInTheDocument();
    expect(screen.queryByText("setup")).not.toBeInTheDocument();
    expect(getSetupStatus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("business page")).toBeInTheDocument();
    expect(getSetupStatus).toHaveBeenCalledTimes(2);
  });

  it("recovers a temporary-password 428 through sign-out and the login form", async () => {
    const account = { id: "member", username: "member", displayName: "成员", role: "MEMBER" as const, mustChangePassword: true };
    sessionStorage.setItem("humite-demo-session", JSON.stringify(account));
    let signedOut = false;
    vi.spyOn(api, "getSetupStatus").mockImplementation(async () => {
      if (!signedOut) throw new ApiRequestError("临时密码只能用于首次登录。", 428, "PASSWORD_CHANGE_REQUIRED");
      return { initialized: true };
    });
    const logout = vi.spyOn(api, "logout").mockRejectedValueOnce(new Error("退出请求失败")).mockImplementation(async () => {
      signedOut = true;
    });
    vi.spyOn(api, "login").mockResolvedValue({ ...account, mustChangePassword: false });
    render(<TestProviders initialPath="/settings#users/roles"><LocationProbe /><SetupGate><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/settings" element={<div>settings page</div>} />
    </Routes></SetupGate></TestProviders>);

    expect(await screen.findByRole("heading", { name: "428" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(await screen.findByText("退出请求失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));

    expect(await screen.findByLabelText("用户名")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
    expect(logout).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem("humite-demo-session")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("settings page")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/settings#users/roles");
  });

  it("keeps the requested route while initialization status is pending", async () => {
    let resolveStatus!: (value: { initialized: boolean }) => void;
    const getSetupStatus = vi.spyOn(api, "getSetupStatus").mockReturnValue(new Promise(resolve => { resolveStatus = resolve; }));
    render(<TestProviders initialPath="/settings#users/roles"><LocationProbe /><SetupGate><Routes><Route path="*" element={<div>business page</div>} /></Routes></SetupGate></TestProviders>);
    expect(screen.getByRole("status", { name: "正在确认系统初始化状态" })).toBeInTheDocument();
    expect(getSetupStatus).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(screen.getByTestId("location")).toHaveTextContent("/settings#users/roles");
    expect(screen.queryByText("business page")).not.toBeInTheDocument();

    resolveStatus({ initialized: true });
    expect(await screen.findByText("business page")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/settings#users/roles");
  });
});
