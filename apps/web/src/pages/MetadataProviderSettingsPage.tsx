import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { usePermissions } from "../auth/permissions";
import { PageContainer, SectionHeader } from "../components/PageHeader";
import type { MetadataProviderId, MetadataProviderSetting, MetadataProviderSettings } from "../domain/types";
import { useAutoSaveForm } from "../hooks/useAutoSaveForm";
import { Button } from "../ui/buttons";
import { CircularProgress } from "../ui/feedback";
import { Switch } from "../ui/forms";
import { Stack, Typography } from "../ui/primitives";
import "./settings-page.css";

function sourceLink(homepage: string) {
  try {
    const url = new URL(homepage);
    return url.protocol === "https:" && ["openlibrary.org", "www.wikidata.org"].includes(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
}

export function MetadataProviderSettingsPage() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canView = can("settings.metadata.view");
  const canEdit = can("settings.metadata.edit");
  const client = useQueryClient();
  const key = useMemo(() => ["metadata-provider-settings", user?.id] as const, [user?.id]);
  const query = useQuery({ queryKey: key, queryFn: api.getMetadataProviderSettings, enabled: canView, retry: false });

  const { form: draft, error, statusNode, update, flush } = useAutoSaveForm<MetadataProviderSetting[], MetadataProviderSettings>({
    initial: query.data?.providers,
    canEdit,
    save: (snapshot) =>
      api.updateMetadataProviderSettings({
        providers: snapshot.map(({ id, enabled }) => ({ id, enabled })),
      }),
    mapSaved: (result) => result.providers,
    onSaved: (result) => client.setQueryData(key, result),
    errorFallback: "书目信息来源保存失败，请重试。",
  });

  const change = (id: MetadataProviderId, enabled: boolean) => {
    if (!canEdit) return;
    update(
      (prev) => prev.map((provider) => (provider.id === id ? { ...provider, enabled } : provider)),
      { immediate: true },
    );
  };

  return (
    <PageContainer>
      <Stack className="bk-settings-stack">
        <Stack className="bk-settings-card" spacing={2}>
          <SectionHeader
            title="书目信息来源"
            description="启用外部书目来源后，编辑书籍元信息时可联网补全封面、简介与出版资料。"
            action={statusNode}
          />
          {query.isError && (
            <Stack role="alert" spacing={1}>
              <Typography color="error">无法读取书目信息来源设置。</Typography>
              <Button disabled={query.isFetching} onClick={() => void query.refetch()}>重试</Button>
            </Stack>
          )}
          {error && (
            <Stack role="alert" direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography color="error">{error}</Typography>
              <Button size="small" onClick={() => void flush().catch(() => undefined)}>重试保存</Button>
            </Stack>
          )}
          {!draft && query.isPending ? (
            <CircularProgress />
          ) : draft && draft.length > 0 ? (
            <div className="bk-settings-toggle-list">
              {draft.map((provider) => {
                const homepage = sourceLink(provider.homepage);
                return (
                  <div key={provider.id} className="bk-settings-toggle-row">
                    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 500 }}>{provider.label}</Typography>
                      <Typography variant="body2" color="text.secondary">{provider.description}</Typography>
                      {!provider.available && <Typography variant="body2" color="text.secondary">该来源当前不可用。</Typography>}
                      {homepage && (
                        <Typography variant="body2">
                          <a href={homepage} target="_blank" rel="noopener noreferrer">查看来源</a>
                        </Typography>
                      )}
                    </Stack>
                    <Switch
                      checked={provider.enabled}
                      disabled={!provider.available || !canEdit}
                      sx={{ flexShrink: 0 }}
                      slotProps={{ input: { "aria-label": provider.label } }}
                      onChange={(_, checked) => change(provider.id, checked)}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </Stack>
      </Stack>
    </PageContainer>
  );
}