import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGrants, rolePermissionApi } from "../auth/permissions";
import { TestProviders } from "../test/TestProviders";
import { RolePermissionsPage } from "./RolePermissionsPage";

const loginOwner = () => {
  sessionStorage.setItem(
    "humite-demo-session",
    JSON.stringify({ id: "owner", username: "owner", displayName: "站点所有者", role: "OWNER", mustChangePassword: false }),
  );
};

describe("RolePermissionsPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes 书单 and 合集 under 发现 in the permission tree and saves updated grants", async () => {
    loginOwner();
    const saveSpy = vi.spyOn(rolePermissionApi, "save");
    render(<TestProviders><RolePermissionsPage /></TestProviders>);

    expect(await screen.findByRole("checkbox", { name: "管理员 · 页面访问" })).toBeInTheDocument();

    const selector = screen.getByRole("combobox", { name: "选择权限页面" });
    fireEvent.mouseDown(selector);
    expect(await screen.findByText("发现", { exact: true })).toBeInTheDocument();
    fireEvent.click(await screen.findByText("书单", { exact: true }));

    expect(screen.getByRole("heading", { name: "书单" })).toBeInTheDocument();
    const memberBooklistsEdit = screen.getByRole("checkbox", { name: "成员 · 管理书单" });
    expect(memberBooklistsEdit).toBeChecked();
    fireEvent.click(memberBooklistsEdit);
    expect(memberBooklistsEdit).not.toBeChecked();

    fireEvent.mouseDown(selector);
    fireEvent.change(selector, { target: { value: "合集" } });
    fireEvent.click(await screen.findByText("合集", { exact: true }));
    expect(screen.getByRole("heading", { name: "合集" })).toBeInTheDocument();
    const memberCollectionView = screen.getByRole("checkbox", { name: "成员 · 页面访问" });
    expect(memberCollectionView).toBeChecked();
    fireEvent.click(memberCollectionView);
    expect(memberCollectionView).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "成员 · 管理合集" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));
    const confirmDialog = await screen.findByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "保存权限" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledOnce());
    const saved = saveSpy.mock.calls[0][0];
    expect(saved.grants.MEMBER).not.toContain("booklists.edit");
    expect(saved.grants.MEMBER).not.toContain("articles.collections.view");
    expect(saved.grants.MEMBER).not.toContain("articles.collections.edit");
    expect(saved.grants.OWNER).toEqual(defaultGrants("OWNER"));
    expect(await screen.findByText("角色权限已保存，对后续请求立即生效。")).toBeInTheDocument();
  });
});
