import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { vaultAccessApi } from "../features/vault/access-api";
import { useAuth } from "../auth/AuthContext";
import { AutoSaveError, AutoSaveStatus, type AutoSaveState } from "../hooks/useAutoSaveForm";
import { Alert } from "../ui/feedback";
import { Stack, Typography } from "../ui/primitives";
import { Switch } from "../ui/forms";
import { Skeleton } from "../ui/antd";
import { publishVaultPolicyChange, vaultNavigationStatusKey } from "../features/vault/use-vault-navigation-status";
import "./settings-page.css";

export function VaultPolicySettings() {
  const { user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["vault-policy"], queryFn: vaultAccessApi.policy });
  const [saveState, setSaveState] = useState<AutoSaveState>("idle");
  const [error, setError] = useState("");
  if (query.isPending) return <Skeleton active />;
  if (query.isError) return <Alert severity="error">无法读取加密书库设置，请刷新重试。</Alert>;
  return (
    <Stack className="bk-settings-card" spacing={2}>
      <Stack direction="row" data-testid="vault-policy-header" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, minWidth: 0 }}>
        <Typography component="h3" variant="h5" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>加密书库</Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexShrink: 0 }}>
          <AutoSaveStatus state={saveState} />
          <Switch
            checked={query.data.enabled}
            disabled={saveState === "saving" || user?.role !== "OWNER" || (!query.data.configured && !query.data.enabled)}
            slotProps={{ input: { "aria-label": "启用加密书库" } }}
            onChange={async (_, enabled) => {
              setSaveState("saving");
              setError("");
              try {
                const saved = await vaultAccessApi.savePolicy(enabled, query.data.revision);
                client.setQueryData(["vault-policy"], saved);
                if (user?.id) {
                  const navKey = vaultNavigationStatusKey(user.id);
                  await client.cancelQueries({ queryKey: navKey });
                  publishVaultPolicyChange(saved.enabled, user.id, client);
                }
                setSaveState("saved");
              } catch (reason) {
                setSaveState("idle");
                setError(reason instanceof Error ? reason.message : "保存失败");
              }
            }}
          />
        </Stack>
      </Stack>
      <Typography color="text.secondary">有访问权限的用户需绑定身份验证器，每次进入时验证身份。关闭后所有用户都无法进入，已有的加密书籍会保留。</Typography>
      {!query.data.configured && <Alert severity="warning">尚未配置身份验证器服务。请在服务器配置 HUMITE_TWO_FACTOR_ENCRYPTION_KEY 后重启，再启用加密书库。</Alert>}
      <AutoSaveError error={error} />
    </Stack>
  );
}
