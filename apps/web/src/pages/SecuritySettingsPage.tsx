// 组合用户安全设置入口，不把前端可见开关当作权限授权。
// Composes user-security controls without treating visible UI switches as authorization.
import { SessionPolicySettings } from "./SessionPolicySettings";
import { PasswordPolicySettings } from "./PasswordPolicySettings";
import { VaultPolicySettings } from "./VaultPolicySettings";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AutoSaveError, AutoSaveStatus, type AutoSaveState } from "../hooks/useAutoSaveForm";
import { Alert } from "../ui/feedback";
import { Stack, Typography } from "../ui/primitives";
import { Switch } from "../ui/forms";
import { Skeleton } from "../ui/antd";
import "./settings-page.css";

export function SecuritySettingsPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["security-settings"], queryFn: api.securitySettings });
  const [saveState, setSaveState] = useState<AutoSaveState>("idle");
  const [error, setError] = useState("");
  if (query.isPending) return <Skeleton active />;
  if (query.isError) return <Alert severity="error">无法读取安全设置，请刷新重试。</Alert>;
  return (
    <Stack className="bk-settings-stack">
      <Stack className="bk-settings-card" spacing={2}>
        <Stack direction="row" data-testid="registration-policy-header" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, minWidth: 0 }}>
          <Typography component="h3" variant="h5" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>开放注册</Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexShrink: 0 }}>
            <AutoSaveStatus state={saveState} />
            <Switch
              checked={query.data.registrationEnabled}
              disabled={saveState === "saving" || user?.role !== "OWNER"}
              slotProps={{ input: { "aria-label": "开放注册" } }}
              onChange={async (_, enabled) => {
                setSaveState("saving");
                setError("");
                try {
                  const result = await api.updateSecuritySettings(enabled);
                  client.setQueryData(["security-settings"], result);
                  await client.invalidateQueries({ queryKey: ["registration-status"] });
                  setSaveState("saved");
                } catch (reason) {
                  setSaveState("idle");
                  setError(reason instanceof Error ? reason.message : "保存失败");
                }
              }}
            />
          </Stack>
        </Stack>
        <Typography color="text.secondary">开启后，访客可以注册普通成员账户。</Typography>
        <AutoSaveError error={error} />
      </Stack>
      <SessionPolicySettings />
      <VaultPolicySettings />
      <PasswordPolicySettings />
      {user?.role !== "OWNER" && <Typography color="text.secondary">仅站点所有者可修改此设置。</Typography>}
    </Stack>
  );
}
