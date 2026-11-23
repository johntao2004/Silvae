import { usePermissions } from "../auth/permissions";
// 编辑提供商配置及启用选择；自动保存与动态模型获取协同工作，已保存密钥仅显示配置状态。
// Edits provider configuration/selection with auto-save and dynamic model discovery; saved keys expose configured status only.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAutoSaveForm } from "../hooks/useAutoSaveForm";
import { Alert } from "@/ui/feedback";
import { _AntAlert } from "@/ui/antd";
import { Box } from "@/ui/primitives";
import { Button } from "@/ui/buttons";
import { Checkbox } from "@/ui/forms";
import { CircularProgress } from "@/ui/feedback";
import { FormControl } from "@/ui/primitives";
import { FormControlLabel } from "@/ui/primitives";
import { InputLabel } from "@/ui/primitives";
import { MenuItem } from "@/ui/primitives";
import { Select } from "@/ui/forms";
import { Stack } from "@/ui/primitives";
import { Switch } from "@/ui/forms";
import { TextField } from "@/ui/forms";
import { Typography } from "@/ui/primitives";
import { SectionHeader, PageContainer } from "../components/PageHeader";
import { api, request } from "../api/client";
import type { AiProviderModelOption, AiProviderSetting, AiProviderSettingInput, AiSettings, AiSettingsInput } from "../domain/types";
import "./settings-page.css";

const customModelValue = "__custom__";

function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return "";
  }
}

function isLocalProviderUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value.trim());
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function validateAiDraft(
  draft: AiSettingsInput,
  selectedProviderId: string,
  maxCandidatesText: string,
  timeoutSecondsText: string,
  customMode: boolean,
): { valid: boolean; maxCandidates: number; timeoutSeconds: number; error: string } {
  const trimmedCandidates = maxCandidatesText.trim();
  const maxCandidates = Number(trimmedCandidates);
  if (!trimmedCandidates || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 10) {
    return { valid: false, maxCandidates: draft.maxCandidates, timeoutSeconds: draft.timeoutSeconds, error: "最多返回候选数需为 1–10 的整数。" };
  }
  const trimmedTimeout = timeoutSecondsText.trim();
  const timeoutSeconds = Number(trimmedTimeout);
  if (!trimmedTimeout || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 120) {
    return { valid: false, maxCandidates, timeoutSeconds: draft.timeoutSeconds, error: "平台超时需为 5–120 秒的整数。" };
  }
  const active = draft.providers.find((p) => p.id === selectedProviderId) ?? draft.providers[0];
  if (active) {
    if (!active.label.trim()) {
      return { valid: false, maxCandidates, timeoutSeconds, error: "请填写平台显示名称。" };
    }
    if (active.baseUrl.trim() && !isValidHttpUrl(active.baseUrl)) {
      return { valid: false, maxCandidates, timeoutSeconds, error: "请输入有效的 HTTP/HTTPS 接口地址。" };
    }
    if (customMode && !active.model.trim()) {
      return { valid: false, maxCandidates, timeoutSeconds, error: "请输入自定义模型 ID。" };
    }
  }
  return { valid: true, maxCandidates, timeoutSeconds, error: "" };
}

interface AiFormState {
  draft: AiSettingsInput;
  selectedProviderId: string;
  maxCandidatesText: string;
  timeoutSecondsText: string;
}

export function AiSettingsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canEdit = can("settings.ai.edit");
  const query = useQuery({ queryKey: ["ai-settings"], queryFn: api.getAiSettings });
  const [customModeByProvider, setCustomModeByProvider] = useState<Record<string, boolean>>({});
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, { models: AiProviderModelOption[]; source: string; hint?: string }>>({});
  const [loadingModels, setLoadingModels] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState("");

  const customModeRef = useRef<Record<string, boolean>>({});
  customModeRef.current = customModeByProvider;
  const modelTimerRef = useRef<number | undefined>(undefined);
  const modelFetchSeqRef = useRef(0);
  const lastModelFetchKeyRef = useRef("");
  const mountedRef = useRef(true);

  const initialForm = useMemo<AiFormState | null>(() => {
    if (!query.data) return null;
    return {
      draft: toDraft(query.data),
      selectedProviderId: query.data.providers.find((provider) => provider.enabled)?.id ?? query.data.providers[0]?.id ?? "",
      maxCandidatesText: String(query.data.maxCandidates),
      timeoutSecondsText: String(query.data.timeoutSeconds),
    };
  }, [query.data]);

  const {
    form,
    error: saveError,
    statusNode,
    update,
    flush,
    handleBlur,
  } = useAutoSaveForm<AiFormState, AiSettings>({
    initial: initialForm,
    canEdit,
    resyncOnInitialChange: false,
    validate: (state) =>
      validateAiDraft(
        state.draft,
        state.selectedProviderId,
        state.maxCandidatesText,
        state.timeoutSecondsText,
        Boolean(customModeRef.current[state.selectedProviderId]),
      ).error,
    save: (state) => {
      const check = validateAiDraft(
        state.draft,
        state.selectedProviderId,
        state.maxCandidatesText,
        state.timeoutSecondsText,
        Boolean(customModeRef.current[state.selectedProviderId]),
      );
      const providers = state.draft.providers.map((provider) => ({
        ...provider,
        enabled: provider.id === state.selectedProviderId,
      }));
      return api.updateAiSettings({
        ...state.draft,
        maxCandidates: check.maxCandidates,
        timeoutSeconds: check.timeoutSeconds,
        providers,
      });
    },
    mapSaved: (_saved, currentForm, snapshot) => {
      const clearedIds = new Set(snapshot.draft.providers.filter((p) => p.clearApiKey).map((p) => p.id));
      if (clearedIds.size === 0) return currentForm;
      return {
        ...currentForm,
        draft: {
          ...currentForm.draft,
          providers: currentForm.draft.providers.map((p) =>
            clearedIds.has(p.id) ? { ...p, apiKey: "", clearApiKey: false } : p,
          ),
        },
      };
    },
    onSaved: (next) => {
      queryClient.setQueryData(["ai-settings"], next);
      void queryClient.invalidateQueries({ queryKey: ["ai-status"] });
    },
    onEdit: () => {
      setTestMessage("");
      setTestError("");
    },
    errorFallback: "AI 设置保存失败，请重试。",
  });

  const clearModelTimer = useCallback(() => {
    if (modelTimerRef.current !== undefined) window.clearTimeout(modelTimerRef.current);
    modelTimerRef.current = undefined;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearModelTimer();
    };
  }, [clearModelTimer]);

  const statuses = useMemo(
    () => new Map((query.data?.providers ?? []).map((provider) => [provider.id, provider])),
    [query.data],
  );

  const draft = form?.draft ?? null;
  const selectedProviderId = form?.selectedProviderId ?? "";
  const maxCandidatesText = form?.maxCandidatesText ?? "4";
  const timeoutSecondsText = form?.timeoutSecondsText ?? "20";

  const selectedProvider = draft?.providers.find((provider) => provider.id === selectedProviderId) ?? draft?.providers[0];
  const selectedStatus = selectedProvider ? statuses.get(selectedProvider.id) : undefined;
  const selectedHasSavedKey = Boolean(
    selectedProvider
    && selectedStatus?.apiKeyConfigured
    && !selectedProvider.clearApiKey
    && normalizeOrigin(selectedProvider.baseUrl) === normalizeOrigin(selectedStatus.baseUrl),
  );
  const selectedCanQueryModels = Boolean(
    selectedProvider
    && isValidHttpUrl(selectedProvider.baseUrl)
    && (Boolean(selectedProvider.apiKey?.trim()) || selectedHasSavedKey || isLocalProviderUrl(selectedProvider.baseUrl)),
  );
  const selectedModelFetchKey = selectedProvider
    ? `${selectedProvider.id}|${selectedProvider.type}|${selectedProvider.baseUrl.trim()}|${selectedProvider.apiKey?.trim() ?? ""}|${selectedHasSavedKey}`
    : "";

  const runModelDiscovery = useCallback(async (provider: AiProviderSettingInput, key: string) => {
    if (!key || lastModelFetchKeyRef.current === key) return;
    lastModelFetchKeyRef.current = key;
    const seq = ++modelFetchSeqRef.current;
    setLoadingModels(true);
    try {
      const response = await api.listAiProviderModels({
        id: provider.id,
        type: provider.type,
        baseUrl: provider.baseUrl.trim(),
        ...(provider.apiKey?.trim() ? { apiKey: provider.apiKey.trim() } : {}),
      });
      if (!mountedRef.current || seq !== modelFetchSeqRef.current) return;
      const models = response?.models ?? [];
      setModelsByProvider((current) => ({
        ...current,
        [provider.id]: {
          models,
          source: response?.source ?? "remote",
          hint: models.length === 0 ? "未获取到可用模型，可选择自定义模型手动输入模型 ID。" : undefined,
        },
      }));
    } catch {
      if (!mountedRef.current || seq !== modelFetchSeqRef.current) return;
      setModelsByProvider((current) => ({
        ...current,
        [provider.id]: {
          models: [],
          source: "fallback",
          hint: "未能获取实时模型列表，可选择自定义模型手动输入模型 ID。",
        },
      }));
    } finally {
      if (mountedRef.current && seq === modelFetchSeqRef.current) {
        setLoadingModels(false);
      }
    }
  }, []);

  useEffect(() => {
    clearModelTimer();
    if (!selectedProvider || !selectedCanQueryModels || !selectedModelFetchKey) {
      setLoadingModels(false);
      return;
    }
    if (lastModelFetchKeyRef.current === selectedModelFetchKey) return;
    const isInitialOrProviderSwitch = !lastModelFetchKeyRef.current.startsWith(`${selectedProvider.id}|`);
    if (isInitialOrProviderSwitch) {
      void runModelDiscovery(selectedProvider, selectedModelFetchKey);
      return;
    }
    modelTimerRef.current = window.setTimeout(() => {
      modelTimerRef.current = undefined;
      void runModelDiscovery(selectedProvider, selectedModelFetchKey);
    }, 500);
    return clearModelTimer;
  }, [clearModelTimer, runModelDiscovery, selectedCanQueryModels, selectedModelFetchKey, selectedProvider]);

  const handleFieldBlur = () => {
    handleBlur();
    if (selectedProvider && selectedCanQueryModels && selectedModelFetchKey && lastModelFetchKeyRef.current !== selectedModelFetchKey) {
      clearModelTimer();
      void runModelDiscovery(selectedProvider, selectedModelFetchKey);
    }
  };

  if (query.isPending) return <PageContainer><Stack sx={{ minHeight: 260, alignItems: "center", justifyContent: "center" }}><CircularProgress /></Stack></PageContainer>;
  if (query.isError || !query.data) return <PageContainer><Alert severity="error">无法读取 AI 设置，请刷新页面后重试。</Alert></PageContainer>;
  if (!draft) return <PageContainer><Stack sx={{ minHeight: 260, alignItems: "center", justifyContent: "center" }}><CircularProgress /></Stack></PageContainer>;

  const updateField = <K extends keyof AiSettingsInput>(key: K, value: AiSettingsInput[K], immediate: boolean) => {
    update(
      (prev) => ({ ...prev, draft: { ...prev.draft, [key]: value } }),
      { immediate },
    );
  };

  const updateProvider = (id: string, patch: Partial<AiProviderSettingInput>, immediate: boolean) => {
    update(
      (prev) => ({
        ...prev,
        draft: {
          ...prev.draft,
          providers: prev.draft.providers.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)),
        },
      }),
      { immediate },
    );
  };

  const modelDiscoveryState = selectedProvider ? modelsByProvider[selectedProvider.id] : undefined;
  const discoveryHint = !selectedProvider
    ? undefined
    : !selectedCanQueryModels
      ? "填写接口地址与 API 密钥后可自动获取可用模型，或选择自定义模型手动输入。"
      : modelDiscoveryState?.hint;

  return (
    <PageContainer>
      <Stack className="bk-settings-stack">
        {saveError && <_AntAlert type="error" role="alert" description={saveError} showIcon />}

        <SettingsPanel
          title="匹配策略"
          description="匹配书目信息时会向 AI 平台发送书名等书目信息。使用阅读或写作辅助时，会发送部分正文或当前草稿。加密书库的内容不会发送给 AI 平台。"
          action={statusNode}
        >
          <div className="bk-settings-toggle-list">
            <div className="bk-settings-toggle-row">
              <SettingLabel
                title="启用 AI 服务"
                description="统一控制助读、编辑辅助、知识点提取与书目匹配；关闭后不会调用 AI 平台。"
              />
              <Switch
                disabled={!canEdit}
                checked={draft.enabled}
                slotProps={{ input: { "aria-label": "启用 AI 服务" } }}
                sx={{ flexShrink: 0 }}
                onChange={(_, checked) => updateField("enabled", checked, true)}
              />
            </div>
            <div className="bk-settings-toggle-row">
              <SettingLabel
                title="用 AI 补查书目信息"
                description="常规来源找不到与 ISBN、书名或作者可靠匹配的结果时，尝试用 AI 查找。"
              />
              <Switch
                checked={draft.autoMatch}
                disabled={!draft.enabled || !canEdit}
                slotProps={{ input: { "aria-label": "用 AI 补查书目信息" } }}
                sx={{ flexShrink: 0 }}
                onChange={(_, checked) => updateField("autoMatch", checked, true)}
              />
            </div>
          </div>
          <div className="bk-settings-field-grid">
            <TextField
              fullWidth
              label="最多返回几个候选"
              type="number"
              disabled={!canEdit}
              value={maxCandidatesText}
              slotProps={{ htmlInput: { min: 1, max: 10 } }}
              onChange={(event) => {
                const nextMax = event.target.value;
                update((prev) => {
                  const check = validateAiDraft(
                    prev.draft,
                    prev.selectedProviderId,
                    nextMax,
                    prev.timeoutSecondsText,
                    Boolean(customModeRef.current[prev.selectedProviderId]),
                  );
                  return {
                    ...prev,
                    maxCandidatesText: nextMax,
                    draft: check.valid ? { ...prev.draft, maxCandidates: check.maxCandidates } : prev.draft,
                  };
                });
              }}
              onBlur={handleFieldBlur}
            />
            <TextField
              fullWidth
              label="平台超时（秒）"
              type="number"
              disabled={!canEdit}
              value={timeoutSecondsText}
              slotProps={{ htmlInput: { min: 5, max: 120 } }}
              onChange={(event) => {
                const nextTimeout = event.target.value;
                update((prev) => {
                  const check = validateAiDraft(
                    prev.draft,
                    prev.selectedProviderId,
                    prev.maxCandidatesText,
                    nextTimeout,
                    Boolean(customModeRef.current[prev.selectedProviderId]),
                  );
                  return {
                    ...prev,
                    timeoutSecondsText: nextTimeout,
                    draft: check.valid ? { ...prev.draft, timeoutSeconds: check.timeoutSeconds } : prev.draft,
                  };
                });
              }}
              onBlur={handleFieldBlur}
            />
          </div>
        </SettingsPanel>

        <SettingsPanel
          title="AI 平台"
          description="选择要使用的厂商并配置模型与接口，修改将自动保存。"
          action={
            <Button
              disabled={testing || !canEdit}
              onClick={async () => {
                setTesting(true);
                setTestError("");
                setTestMessage("");
                try {
                  await flush();
                  const result = await request<{ provider: string; model: string; elapsedMs: number }>(
                    "/ai/test",
                    { method: "POST" },
                    { timeoutMs: 150000 },
                  );
                  setTestMessage(`${result.provider} · ${result.model} 连接成功（${(result.elapsedMs / 1000).toFixed(1)} 秒）。使用已保存配置，未发送书籍或私人内容。`);
                } catch (reason) {
                  setTestError(reason instanceof Error ? reason.message : "连接测试失败，请重试。");
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? "检测中…" : "测试已保存配置"}
            </Button>
          }
        >
          <Stack spacing={2} sx={{ width: "100%", maxWidth: "none" }}>
            <div className="bk-settings-field-grid">
              <FormControl fullWidth>
                <InputLabel id="ai-provider-select-label">选择厂商</InputLabel>
                <Select
                  labelId="ai-provider-select-label"
                  label="选择厂商"
                  value={selectedProvider?.id ?? ""}
                  disabled={!canEdit}
                  onChange={(event: { target: { value: string } }) => {
                    const nextId = event.target.value;
                    update(
                      (prev) => ({
                        ...prev,
                        selectedProviderId: nextId,
                        draft: {
                          ...prev.draft,
                          providers: prev.draft.providers.map((provider) => ({ ...provider, enabled: provider.id === nextId })),
                        },
                      }),
                      { immediate: true },
                    );
                  }}
                >
                  {draft.providers.map((provider) => <MenuItem key={provider.id} value={provider.id}>{provider.label}</MenuItem>)}
                </Select>
              </FormControl>
              {selectedProvider && (
                <TextField
                  fullWidth
                  label="显示名称"
                  value={selectedProvider.label}
                  disabled={!canEdit}
                  onChange={(event) => updateProvider(selectedProvider.id, { label: event.target.value }, false)}
                  onBlur={handleFieldBlur}
                />
              )}
            </div>
            {selectedProvider && (
              <ProviderPanel
                key={selectedProvider.id}
                provider={selectedProvider}
                status={selectedStatus}
                disabled={!canEdit}
                liveModels={modelDiscoveryState?.models}
                loadingModels={loadingModels}
                discoveryHint={discoveryHint}
                customMode={Boolean(customModeByProvider[selectedProvider.id])}
                onSelectPreset={(model) => {
                  const nextCustom = { ...customModeRef.current, [selectedProvider.id]: false };
                  customModeRef.current = nextCustom;
                  setCustomModeByProvider(nextCustom);
                  updateProvider(selectedProvider.id, { model }, true);
                }}
                onEnterCustomMode={() => {
                  const nextCustom = { ...customModeRef.current, [selectedProvider.id]: true };
                  customModeRef.current = nextCustom;
                  setCustomModeByProvider(nextCustom);
                }}
                onChange={(patch, immediate) => updateProvider(selectedProvider.id, patch, immediate)}
                onBlur={handleFieldBlur}
              />
            )}
            {testMessage && <_AntAlert type="success" description={testMessage} showIcon />}
            {!saveError && testError && <_AntAlert type="error" role="alert" description={testError} showIcon />}
          </Stack>
        </SettingsPanel>
      </Stack>
    </PageContainer>
  );
}

function ProviderPanel({
  provider,
  status,
  disabled,
  liveModels,
  loadingModels,
  discoveryHint,
  customMode,
  onSelectPreset,
  onEnterCustomMode,
  onChange,
  onBlur,
}: {
  provider: AiProviderSettingInput;
  status?: AiProviderSetting;
  disabled: boolean;
  liveModels?: AiProviderModelOption[];
  loadingModels: boolean;
  discoveryHint?: string;
  customMode: boolean;
  onSelectPreset: (model: string) => void;
  onEnterCustomMode: () => void;
  onChange: (patch: Partial<AiProviderSettingInput>, immediate: boolean) => void;
  onBlur: () => void;
}) {
  return (
    <Stack spacing={2}>
      <div className="bk-settings-field-grid">
        <TextField
          fullWidth
          label="接口地址"
          value={provider.baseUrl}
          disabled={disabled}
          onChange={(event) => onChange({ baseUrl: event.target.value }, false)}
          onBlur={onBlur}
        />
        <TextField
          fullWidth
          type="password"
          label="API 密钥"
          value={provider.apiKey ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ apiKey: event.target.value, clearApiKey: false }, false)}
          onBlur={onBlur}
          placeholder={status?.apiKeyConfigured ? "已配置，留空保持不变" : "请输入 API 密钥"}
          helperText={status?.apiKeyConfigured ? "密钥已保存，留空保持不变。" : undefined}
          autoComplete="new-password"
        />
      </div>
      <ModelField
        provider={provider}
        disabled={disabled}
        liveModels={liveModels}
        loadingModels={loadingModels}
        discoveryHint={discoveryHint}
        customMode={customMode}
        onSelectPreset={onSelectPreset}
        onEnterCustomMode={onEnterCustomMode}
        onCustomModelChange={(model) => onChange({ model }, false)}
        onBlur={onBlur}
      />
      {status?.apiKeyConfigured && (
        <FormControlLabel
          control={
            <Checkbox
              checked={provider.clearApiKey}
              disabled={disabled}
              onChange={(event) => onChange({ clearApiKey: event.target.checked, apiKey: "" }, event.target.checked)}
            />
          }
          label="清除密钥"
        />
      )}
    </Stack>
  );
}

function ModelField({
  provider,
  disabled,
  liveModels,
  loadingModels,
  discoveryHint,
  customMode,
  onSelectPreset,
  onEnterCustomMode,
  onCustomModelChange,
  onBlur,
}: {
  provider: AiProviderSettingInput;
  disabled: boolean;
  liveModels?: AiProviderModelOption[];
  loadingModels: boolean;
  discoveryHint?: string;
  customMode: boolean;
  onSelectPreset: (model: string) => void;
  onEnterCustomMode: () => void;
  onCustomModelChange: (model: string) => void;
  onBlur: () => void;
}) {
  const currentModel = provider.model.trim();
  const options = useMemo(() => {
    const seen = new Set<string>();
    const deduped: Array<{ value: string; label: string }> = [];
    for (const item of liveModels ?? []) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push({ value: item.id, label: item.label || item.id });
    }
    if (!customMode && currentModel && !seen.has(currentModel)) {
      deduped.unshift({ value: currentModel, label: currentModel });
    }
    return deduped;
  }, [currentModel, customMode, liveModels]);

  const selectValue = customMode ? customModelValue : (currentModel || undefined);

  return (
    <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
      <FormControl fullWidth>
        <InputLabel id={`ai-model-preset-${provider.id}`}>模型预设</InputLabel>
        <Select
          labelId={`ai-model-preset-${provider.id}`}
          label="模型预设"
          value={selectValue}
          disabled={disabled}
          placeholder="填写凭证后自动获取，或选择自定义模型"
          onChange={(event: { target: { value: string } }) => {
            if (event.target.value === customModelValue) {
              onEnterCustomMode();
              return;
            }
            onSelectPreset(event.target.value);
          }}
        >
          {options.map((preset) => <MenuItem key={preset.value} value={preset.value}>{preset.label}</MenuItem>)}
          <MenuItem value={customModelValue}>自定义模型</MenuItem>
        </Select>
      </FormControl>
      {loadingModels ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">正在获取可用模型…</Typography>
        </Stack>
      ) : discoveryHint ? (
        <Typography variant="caption" color="text.secondary">{discoveryHint}</Typography>
      ) : null}
      {customMode && (
        <TextField
          fullWidth
          label="自定义模型 ID"
          value={provider.model}
          disabled={disabled}
          onChange={(event) => onCustomModelChange(event.target.value)}
          onBlur={onBlur}
        />
      )}
    </Stack>
  );
}

function SettingsPanel({ title, description, children, action }: { title: string; description: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Stack spacing={2} className="bk-settings-card">
      <SectionHeader title={title} description={description} action={action} />
      {children}
    </Stack>
  );
}

function SettingLabel({ title, description }: { title: string; description: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="span" sx={{ display: "block", fontWeight: 700 }}>{title}</Typography>
      <Typography component="span" variant="body2" color="text.secondary">{description}</Typography>
    </Box>
  );
}

function toDraft(settings: AiSettings): AiSettingsInput {
  return {
    enabled: settings.enabled,
    autoMatch: settings.autoMatch,
    maxCandidates: settings.maxCandidates,
    timeoutSeconds: settings.timeoutSeconds,
    providers: settings.providers.map(({ id, label, type, enabled, baseUrl, model }) => ({
      id,
      label,
      type,
      enabled,
      baseUrl,
      model,
      apiKey: "",
      clearApiKey: false,
    })),
  };
}