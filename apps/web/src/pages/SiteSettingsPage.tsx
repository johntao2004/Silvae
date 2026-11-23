// 站点所有者编辑站点个性化配置，自动保存结果通过公共设置查询刷新消费方。
// Owner site-personalization edits auto-save and refresh consumers through the shared settings query.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SiteSettings } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SectionHeader } from "../components/PageHeader";
import { AutoSaveError, useAutoSaveForm } from "../hooks/useAutoSaveForm";
import { Alert } from "../ui/feedback";
import { TextField, Switch } from "../ui/forms";
import { Stack, Typography } from "../ui/primitives";
import { Skeleton } from "../ui/antd";
import "./settings-page.css";

function validateSiteSettings(form: SiteSettings): string {
  if (!form.name.trim()) return "请填写网站名称。";
  const url = form.publicUrl.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const validScheme = parsed.protocol === "https:" || parsed.protocol === "http:";
      if (!validScheme || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
        return "站点地址需为完整的 HTTP/HTTPS 域名地址，不含路径、账号、查询参数或片段。";
      }
    } catch {
      return "站点地址需为完整的 HTTP/HTTPS 域名地址，不含路径、账号、查询参数或片段。";
    }
  }
  const email = form.contactEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "请输入有效的公开联系邮箱。";
  }
  return "";
}

export function SiteSettingsPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["site-settings"], queryFn: ({ signal }) => api.siteSettings(signal) });
  if (query.isPending) return <Skeleton active />;
  if (query.isError || !query.data) return <Alert severity="error">无法读取个性化设置，请稍后重试。</Alert>;
  return (
    <SiteSettingsForm
      initial={query.data}
      canEdit={user?.role === "OWNER"}
      onSaved={(result) => client.setQueryData(["site-settings"], result)}
    />
  );
}

function SiteSettingsForm({ initial, canEdit, onSaved }: {
  initial: SiteSettings;
  canEdit: boolean;
  onSaved: (result: SiteSettings) => void;
}) {
  const { form, error, statusNode, update, handleBlur } = useAutoSaveForm({
    initial,
    canEdit,
    validate: validateSiteSettings,
    save: api.saveSiteSettings,
    onSaved,
  });

  const scheduleUpdate = (key: keyof SiteSettings, value: string | boolean, immediate: boolean) => {
    update((prev) => ({ ...prev, [key]: value }), { immediate });
  };

  const field = (key: keyof SiteSettings, label: string, max: number, helper?: string) => (
    <TextField
      label={label}
      value={String(form[key])}
      disabled={!canEdit}
      onChange={(e) => scheduleUpdate(key, e.target.value, false)}
      onBlur={handleBlur}
      helperText={helper}
      slotProps={{ htmlInput: { maxLength: max } }}
    />
  );

  return (
    <Stack className="bk-settings-stack">
      <AutoSaveError error={error} />
      <Stack className="bk-settings-card" spacing={2}>
        <SectionHeader title="基本信息" action={statusNode} />
        <div className="bk-settings-field-grid">
          <TextField
            label="网站名称"
            required
            value={form.name}
            disabled={!canEdit}
            error={!form.name.trim()}
            onChange={(e) => scheduleUpdate("name", e.target.value, false)}
            onBlur={handleBlur}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          {field("tagline", "网站副标题", 120)}
          <TextField
            className="bk-settings-field-full"
            label="网站简介"
            multiline
            minRows={3}
            value={form.description}
            disabled={!canEdit}
            onChange={(e) => scheduleUpdate("description", e.target.value, false)}
            onBlur={handleBlur}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </div>
      </Stack>
      <Stack className="bk-settings-card" spacing={2}>
        <SectionHeader title="可选功能" />
        <div className="bk-settings-toggle-list">
          <div className="bk-settings-toggle-row">
            <Typography sx={{ minWidth: 0 }}>启用3D 书库</Typography>
            <Switch
              checked={form.virtualLibraryEnabled}
              disabled={!canEdit}
              sx={{ flexShrink: 0 }}
              slotProps={{ input: { "aria-label": "启用3D 书库" } }}
              onChange={(_, checked) => scheduleUpdate("virtualLibraryEnabled", checked, true)}
            />
          </div>
        </div>
      </Stack>
      <Stack className="bk-settings-card" spacing={2}>
        <SectionHeader title="域名与搜索引擎" />
        <div className="bk-settings-field-grid">
          {field("publicUrl", "站点地址（域名）", 255, "完整网址，留空使用当前地址。")}
          {field("keywords", "网站关键词", 250, "用逗号分隔")}
        </div>
        <div className="bk-settings-toggle-list">
          <div className="bk-settings-toggle-row">
            <Typography sx={{ minWidth: 0 }}>允许搜索引擎收录</Typography>
            <Switch
              checked={form.allowIndexing}
              disabled={!canEdit}
              sx={{ flexShrink: 0 }}
              slotProps={{ input: { "aria-label": "允许搜索引擎收录" } }}
              onChange={(_, checked) => scheduleUpdate("allowIndexing", checked, true)}
            />
          </div>
        </div>
      </Stack>
      <Stack className="bk-settings-card" spacing={2}>
        <SectionHeader title="备案与页脚" />
        <div className="bk-settings-field-grid">
          {field("icpNumber", "ICP备案号", 80)}
          {field("policeNumber", "公安备案号", 80)}
          {field("copyright", "版权说明", 200)}
          <TextField
            type="email"
            label="公开联系邮箱"
            value={form.contactEmail}
            disabled={!canEdit}
            onChange={(e) => scheduleUpdate("contactEmail", e.target.value, false)}
            onBlur={handleBlur}
            slotProps={{ htmlInput: { maxLength: 254 } }}
          />
        </div>
      </Stack>
    </Stack>
  );
}