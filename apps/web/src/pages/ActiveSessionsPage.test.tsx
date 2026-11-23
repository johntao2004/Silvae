// 验证会话列表显示管理信息但不暴露 Cookie 会话标识。
// Checks session-management listings do not expose cookie session identifiers.
import { fireEvent,render,screen,within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TestProviders } from "../test/TestProviders";
import { api } from "../api/client";
import { ActiveSessionsPage } from "./ActiveSessionsPage";

afterEach(() => vi.restoreAllMocks());

it("lists each active session without exposing its cookie identifier",async()=>{
 sessionStorage.setItem("humite-demo-session",JSON.stringify({id:"owner",role:"OWNER",username:"owner",displayName:"站点所有者",mustChangePassword:false}));
 const sessions=vi.spyOn(api,"activeSessions").mockResolvedValue([{id:"internal-id",userId:"reader",username:"reader",displayName:"成员",role:"MEMBER",createdAt:"2026-10-20T00:00:00Z",lastAccessAt:"2026-10-20T00:01:00Z",expiresAt:"2026-10-21T00:00:00Z",current:false,ending:false}]);
 const revoke=vi.spyOn(api,"revokeUserSessions").mockResolvedValue();
 render(<TestProviders><ActiveSessionsPage/></TestProviders>);
 const table=await screen.findByRole("table",{name:"登录会话"});expect(await within(table).findByText("成员（reader）")).toBeInTheDocument();expect(table).not.toHaveTextContent("internal-id");
 expect(screen.getByText("共 1 条")).toBeInTheDocument();
 fireEvent.click(within(table).getByRole("button",{name:"让此用户退出登录"}));expect(await screen.findByText(/确定让“成员”在所有设备上退出登录吗/)).toBeInTheDocument();expect(revoke).not.toHaveBeenCalled();
 sessions.mockRestore();revoke.mockRestore();
});

it("paginates active sessions with default pageSize of 5", async () => {
 sessionStorage.setItem("humite-demo-session", JSON.stringify({ id: "owner", role: "OWNER", username: "owner", displayName: "站点所有者", mustChangePassword: false }));
 vi.spyOn(api, "activeSessions").mockResolvedValue(
  Array.from({ length: 6 }, (_, index) => ({
   id: `sess-${index + 1}`,
   userId: `u-${index + 1}`,
   username: `user${index + 1}`,
   displayName: `成员 ${index + 1}`,
   role: "MEMBER",
   createdAt: "2026-10-20T00:00:00Z",
   lastAccessAt: "2026-10-20T00:01:00Z",
   expiresAt: "2026-10-21T00:00:00Z",
   current: index === 0,
   ending: false,
  })),
 );
 render(<TestProviders><ActiveSessionsPage /></TestProviders>);
 const table = await screen.findByRole("table", { name: "登录会话" });
 expect(await within(table).findByText("成员 1（user1）")).toBeInTheDocument();
 expect(within(table).queryByText("成员 6（user6）")).not.toBeInTheDocument();
 expect(screen.getByText("共 6 条")).toBeInTheDocument();
 fireEvent.click(screen.getByTitle("2"));
 expect(await within(table).findByText("成员 6（user6）")).toBeInTheDocument();
});
