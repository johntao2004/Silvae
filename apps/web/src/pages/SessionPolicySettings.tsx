// 设置绝对会话时长并使用服务器返回值更新，客户端倒计时不替代服务端过期检查。
// Edits absolute session lifetime using server results; client countdowns do not replace server expiry checks.
import { type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SectionHeader } from "../components/PageHeader";
import { AutoSaveError, useAutoSaveForm } from "../hooks/useAutoSaveForm";
import { TextField } from "../ui/forms";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/antd";
import { Stack } from "../ui/primitives";
import "./settings-page.css";

function validateSessionMinutes(raw: string): { valid: boolean; value: number; error: string } {
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (!trimmed || !Number.isInteger(parsed) || parsed < 5 || parsed > 43200) {
    return { valid: false, value: 0, error: "请输入 5–43200 分钟的整数。" };
  }
  return { valid: true, value: parsed, error: "" };
}

export function SessionPolicySettings() {
  const { user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["session-policy"], queryFn: api.sessionPolicy });
  if (query.isPending) return <Skeleton active />;
  if (query.isError || !query.data) return <Alert severity="error">无法读取会话设置，请刷新重试。</Alert>;
  return <SessionPolicyForm initialMinutes={query.data.maxMinutes} canEdit={user?.role === "OWNER"} onSaved={(result) => client.setQueryData(["session-policy"], result)} />;
}

function SessionPolicyForm({ initialMinutes, canEdit, onSaved }: {
  initialMinutes: number;
  canEdit: boolean;
  onSaved: (result: { maxMinutes: number }) => void;
}) {
  const { form: rawMinutes, error, statusNode, update, handleBlur } = useAutoSaveForm<string, { maxMinutes: number }>({
    initial: String(initialMinutes),
    canEdit,
    validate: (raw) => validateSessionMinutes(raw).error,
    save: (raw) => api.saveSessionPolicy(validateSessionMinutes(raw).value),
    mapSaved: (result) => String(result.maxMinutes),
    onSaved,
    errorFallback: "保存失败",
  });

  return (
    <Stack className="bk-settings-card" spacing={2}>
      <SectionHeader title="会话时长" action={statusNode} />
      <TextField
        label="最长登录时长（分钟）"
        type="number"
        value={rawMinutes}
        disabled={!canEdit}
        error={Boolean(error)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => update(event.target.value)}
        onBlur={handleBlur}
        helperText="从登录时开始计时，到期前保存阅读进度并退出。适用于所有现有和新会话。"
      />
      <AutoSaveError error={error} />
    </Stack>
  );
}