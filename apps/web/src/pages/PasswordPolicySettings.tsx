// 编辑当前密码复杂度策略，规则变化不意味着重新验证所有已有密码。
// Edits current password complexity rules without implying revalidation of every existing password.
import { useMemo, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type PasswordPolicy } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MAX_PASSWORD_LENGTH, usePasswordPolicy } from "../auth/password-policy";
import { AutoSaveError, useAutoSaveForm } from "../hooks/useAutoSaveForm";
import { Stack, Typography } from "../ui/primitives";
import { TextField, Switch } from "../ui/forms";
import { SectionHeader } from "../components/PageHeader";
import "./settings-page.css";

interface PasswordPolicyDraft {
  policy: PasswordPolicy;
  minLengthText: string;
}

function validateMinLength(raw: string): { valid: boolean; value: number; error: string } {
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (!trimmed || !Number.isInteger(parsed) || parsed < 8 || parsed > MAX_PASSWORD_LENGTH) {
    return { valid: false, value: 0, error: `最小长度需为 8–${MAX_PASSWORD_LENGTH} 的整数。` };
  }
  return { valid: true, value: parsed, error: "" };
}

export function PasswordPolicySettings() {
  const query = usePasswordPolicy();
  if (!query.data) return <Typography>{query.isError ? "密码规则读取失败，请刷新重试。" : "正在加载密码规则…"}</Typography>;
  return <PolicyForm initial={query.data} />;
}

function PolicyForm({ initial }: { initial: PasswordPolicy }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const canEdit = user?.role === "OWNER";
  const initialDraft = useMemo<PasswordPolicyDraft>(
    () => ({ policy: initial, minLengthText: String(initial.minLength) }),
    [initial],
  );

  const { form: draft, error, statusNode, update, handleBlur } = useAutoSaveForm<PasswordPolicyDraft, PasswordPolicy>({
    initial: initialDraft,
    canEdit,
    validate: (current) => validateMinLength(current.minLengthText).error,
    save: (current) => {
      const check = validateMinLength(current.minLengthText);
      return api.savePasswordPolicy({ ...current.policy, minLength: check.value });
    },
    mapSaved: (result) => ({ policy: result, minLengthText: String(result.minLength) }),
    onSaved: (result) => client.setQueryData(["password-policy"], result),
    errorFallback: "保存失败",
  });

  const options = [
    ["requireUppercase", "要求大写字母"],
    ["requireLowercase", "要求小写字母"],
    ["requireDigit", "要求数字"],
    ["requireSpecial", "要求英文标点或符号"],
  ] as const;

  return (
    <Stack className="bk-settings-card" spacing={2}>
      <SectionHeader title="密码复杂度" action={statusNode} />
      <Typography color="text.secondary">对新设置的密码生效，适用于注册、修改密码和邮件重置；已有密码仍可登录。</Typography>
      <TextField
        label="密码最小长度"
        type="number"
        value={draft.minLengthText}
        disabled={!canEdit}
        error={Boolean(error)}
        helperText={`可设置 8–${MAX_PASSWORD_LENGTH} 个字符。`}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const nextRaw = e.target.value;
          update((prev) => {
            const check = validateMinLength(nextRaw);
            return {
              minLengthText: nextRaw,
              policy: check.valid ? { ...prev.policy, minLength: check.value } : prev.policy,
            };
          });
        }}
        onBlur={handleBlur}
      />
      <div className="bk-settings-toggle-list">
        {options.map(([key, label]) => (
          <div key={key} className="bk-settings-toggle-row">
            <Typography sx={{ minWidth: 0 }}>{label}</Typography>
            <Switch
              checked={draft.policy[key]}
              disabled={!canEdit}
              slotProps={{ input: { "aria-label": label } }}
              sx={{ flexShrink: 0 }}
              onChange={(_, v) =>
                update((prev) => ({
                  ...prev,
                  policy: { ...prev.policy, [key]: v },
                }), { immediate: true })
              }
            />
          </div>
        ))}
      </div>
      <AutoSaveError error={error} />
    </Stack>
  );
}