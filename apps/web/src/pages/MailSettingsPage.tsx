// 站点所有者配置 SMTP 并自动保存；已保存密码不会从设置读取响应回填，自动保存完成后再允许发送测试邮件。
// Owner SMTP configuration auto-saves without refilling saved passwords; test mail unlocks once auto-save settles.
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MailSettings } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AutoSaveError, useAutoSaveForm } from "../hooks/useAutoSaveForm";
import { FormControl, InputLabel, MenuItem, Stack, Typography } from "../ui/primitives";
import { TextField, Switch, Select } from "../ui/forms";
import { Button } from "../ui/buttons";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/antd";
import { SectionHeader } from "../components/PageHeader";
import "./settings-page.css";

interface MailFormDraft {
  settings: MailSettings;
  portText: string;
}

function validateMailSettings(form: MailSettings, portText: string): { valid: boolean; port: number; error: string } {
  const host = form.host.trim();
  if (!host || /[\s/@:]+/.test(host)) {
    return { valid: false, port: form.port, error: "请检查 SMTP 主机，不要包含空格、斜杠或端口。" };
  }
  const trimmedPort = portText.trim();
  const port = Number(trimmedPort);
  if (!trimmedPort || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { valid: false, port: form.port, error: "SMTP 端口需为 1–65535 的整数。" };
  }
  if (form.security === "LOCAL" && !["localhost", "127.0.0.1"].includes(host)) {
    return { valid: false, port, error: "不加密模式仅允许连接本机测试邮件服务。" };
  }
  const sender = form.sender.trim();
  if (!sender || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) {
    return { valid: false, port, error: "请填写有效的发件邮箱。" };
  }
  const url = form.publicUrl.trim();
  if (!url) {
    return { valid: false, port, error: "请填写 Humite 站点地址。" };
  }
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
    const validScheme = parsed.protocol === "https:" || (local && parsed.protocol === "http:");
    if (!validScheme || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
      return { valid: false, port, error: "站点地址需要 HTTPS；本机测试可使用 http://127.0.0.1:4173。" };
    }
  } catch {
    return { valid: false, port, error: "站点地址需要 HTTPS；本机测试可使用 http://127.0.0.1:4173。" };
  }
  return { valid: true, port, error: "" };
}

export function MailSettingsPage() {
  const query = useQuery({ queryKey: ["mail-settings"], queryFn: api.mailSettings });
  if (query.isPending) return <Skeleton active />;
  if (query.isError || !query.data) {
    return (
      <Stack className="bk-settings-stack">
        <Stack className="bk-settings-card" spacing={2}>
          <Alert severity="error">邮件配置加载失败。</Alert>
          <Stack direction="row">
            <Button onClick={() => void query.refetch()}>重试</Button>
          </Stack>
        </Stack>
      </Stack>
    );
  }
  return <MailForm initial={query.data} />;
}

function MailForm({ initial }: { initial: MailSettings }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const canEdit = user?.role === "OWNER";
  const [recipient, setRecipient] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState("");

  const initialDraft = useMemo<MailFormDraft>(
    () => ({ settings: initial, portText: String(initial.port) }),
    [initial],
  );

  const {
    form: draft,
    saveState,
    error: saveError,
    dirty,
    statusNode,
    update,
    handleBlur,
  } = useAutoSaveForm<MailFormDraft, MailSettings>({
    initial: initialDraft,
    canEdit,
    validate: (current) => validateMailSettings(current.settings, current.portText).error,
    save: (current) => {
      const check = validateMailSettings(current.settings, current.portText);
      return api.saveMailSettings({ ...current.settings, port: check.port });
    },
    mapSaved: (saved) => ({ settings: saved, portText: String(saved.port) }),
    onSaved: (saved) => client.setQueryData(["mail-settings"], saved),
    onEdit: () => {
      setTestMessage("");
      setTestError("");
    },
    errorFallback: "操作失败",
  });

  const { settings: form, portText } = draft;

  const applyChange = (patch: Partial<MailSettings>, nextPortText?: string, immediate = false) => {
    update((prev) => {
      const merged = { ...prev.settings, ...patch };
      const resolvedPortText = nextPortText ?? prev.portText;
      const check = validateMailSettings(merged, resolvedPortText);
      return {
        settings: check.valid ? { ...merged, port: check.port } : merged,
        portText: resolvedPortText,
      };
    }, { immediate });
  };

  const sendTest = async (event: FormEvent) => {
    event.preventDefault();
    setTesting(true);
    setTestError("");
    setTestMessage("");
    try {
      await api.testMail(recipient);
      setTestMessage("测试邮件已提交，请检查收件箱和垃圾邮件。");
    } catch (reason) {
      setTestError(reason instanceof Error ? reason.message : "发送失败");
    } finally {
      setTesting(false);
    }
  };

  const displayError = saveError || testError;

  return (
    <Stack className="bk-settings-stack">
      <Stack className="bk-settings-card" spacing={2}>
        <SectionHeader title="SMTP 配置" action={statusNode} />
        <Typography color="text.secondary">设置邮件服务器，用于发送邮箱验证邮件和密码重置链接。只有站点所有者可以修改。</Typography>
        <div className="bk-settings-toggle-list">
          <div className="bk-settings-toggle-row">
            <Typography sx={{ minWidth: 0 }}>启用邮件服务</Typography>
            <Switch
              disabled={!canEdit}
              checked={form.enabled}
              sx={{ flexShrink: 0 }}
              onChange={(_, v) => applyChange({ enabled: v }, undefined, true)}
              slotProps={{ input: { "aria-label": "启用邮件服务" } }}
            />
          </div>
        </div>
        <div className="bk-settings-field-grid">
          <TextField
            disabled={!canEdit}
            label="SMTP 主机"
            required
            value={form.host}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applyChange({ host: e.target.value })}
            onBlur={handleBlur}
          />
          <TextField
            disabled={!canEdit}
            label="SMTP 端口"
            required
            type="number"
            value={portText}
            slotProps={{ htmlInput: { min: 1, max: 65535 } }}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applyChange({}, e.target.value)}
            onBlur={handleBlur}
          />
          <FormControl fullWidth>
            <InputLabel id="mail-security-label">连接加密</InputLabel>
            <Select
              labelId="mail-security-label"
              disabled={!canEdit}
              label="连接加密"
              value={form.security}
              onChange={(e: { target: { value: string } }) => applyChange({ security: e.target.value }, undefined, true)}
            >
              <MenuItem value="STARTTLS">STARTTLS（通常为 587）</MenuItem>
              <MenuItem value="TLS">TLS（通常为 465）</MenuItem>
              <MenuItem value="LOCAL">本机测试，不加密</MenuItem>
            </Select>
          </FormControl>
          <TextField
            disabled={!canEdit}
            label="SMTP 用户名"
            autoComplete="off"
            value={form.username}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applyChange({ username: e.target.value })}
            onBlur={handleBlur}
          />
          <TextField
            className="bk-settings-field-full"
            disabled={!canEdit}
            label="SMTP 密码或授权码"
            type="password"
            autoComplete="new-password"
            helperText={form.passwordConfigured ? "已保存，留空保留原授权码。" : "填写邮件服务商提供的密码或授权码。"}
            value={form.password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applyChange({ password: e.target.value })}
            onBlur={handleBlur}
          />
          <TextField
            disabled={!canEdit}
            label="发件邮箱"
            type="email"
            required
            value={form.sender}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applyChange({ sender: e.target.value })}
            onBlur={handleBlur}
          />
          <TextField
            disabled={!canEdit}
            label="Humite 站点地址"
            type="url"
            required
            helperText="邮件链接将使用此地址。正式使用请填写可访问的 HTTPS 地址。"
            value={form.publicUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applyChange({ publicUrl: e.target.value })}
            onBlur={handleBlur}
          />
        </div>
      </Stack>

      <Stack className="bk-settings-card" component="form" spacing={2} onSubmit={(e: FormEvent) => void sendTest(e)}>
        <SectionHeader
          title="发送测试邮件"
          action={<Button type="submit" disabled={testing || dirty || saveState === "saving" || !form.enabled || Boolean(saveError) || !canEdit}>{testing ? "发送中…" : "发送测试"}</Button>}
        />
        <TextField
          disabled={testing || !canEdit}
          label="测试收件邮箱"
          type="email"
          required
          value={recipient}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value)}
        />
        {dirty && <Typography color="text.secondary">请先完成有效配置保存，再发送测试邮件。</Typography>}
      </Stack>

      <AutoSaveError error={displayError} />
      {testMessage && <Alert severity="success">{testMessage}</Alert>}
    </Stack>
  );
}