// 验证空初始模型预设、凭证与本地端点自动获取模型、自定义模型编辑、统一设置布局与测试已保存配置。
// Checks empty initial model presets, credential/local live model discovery, custom model entry, unified layout, and saved-config testing.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TestProviders } from "../test/TestProviders";
import { api, request } from "../api/client";
import { AiSettingsPage } from "./AiSettingsPage";

vi.mock("../api/client", () => ({
  request: vi.fn(),
  api: {
    isDemo: true,
    getAiSettings: vi.fn(),
    updateAiSettings: vi.fn(),
    listAiProviderModels: vi.fn(),
  },
}));

const settings = {
  enabled: false,
  autoMatch: true,
  maxCandidates: 4,
  timeoutSeconds: 20,
  providers: [
    { id: "openai", label: "OpenAI", type: "OPENAI_COMPATIBLE" as const, enabled: false, baseUrl: "https://api.openai.com/v1", model: "", configured: false, available: false, apiKeyConfigured: false },
    { id: "deepseek", label: "DeepSeek", type: "OPENAI_COMPATIBLE" as const, enabled: false, baseUrl: "https://api.deepseek.com", model: "", configured: false, available: false, apiKeyConfigured: false },
    { id: "zhipu", label: "智谱", type: "OPENAI_COMPATIBLE" as const, enabled: false, baseUrl: "https://open.bigmodel.cn/api/paas/v4/", model: "", configured: false, available: false, apiKeyConfigured: false },
    { id: "ollama", label: "Ollama（本地）", type: "OPENAI_COMPATIBLE" as const, enabled: false, baseUrl: "http://127.0.0.1:11434/v1", model: "", configured: false, available: false, apiKeyConfigured: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.setItem("humite-demo-session", JSON.stringify({
    id: "admin", username: "admin", displayName: "管理员", role: "ADMIN", mustChangePassword: false,
  }));
  vi.mocked(api.getAiSettings).mockResolvedValue(settings);
  vi.mocked(api.updateAiSettings).mockResolvedValue(settings);
  vi.mocked(api.listAiProviderModels).mockResolvedValue({ models: [], source: "empty" });
  vi.mocked(request).mockReset();
});

it("tests saved provider settings directly when there are no pending changes", async () => {
  vi.mocked(request).mockResolvedValue({ provider: "DeepSeek", model: "deepseek-chat", elapsedMs: 320 });
  render(<TestProviders><AiSettingsPage /></TestProviders>);
  fireEvent.click(await screen.findByRole("button", { name: "测试已保存配置" }));
  expect(await screen.findByText(/连接成功/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith("/ai/test", { method: "POST" }, { timeoutMs: 150000 });
  expect(api.updateAiSettings).not.toHaveBeenCalled();
});

it("renders unified settings layout with empty initial presets and no hardcoded models", async () => {
  const { container } = render(<TestProviders><AiSettingsPage /></TestProviders>);
  const strategyHeading = await screen.findByRole("heading", { name: "匹配策略" });
  const providerHeading = screen.getByRole("heading", { name: "AI 平台" });

  expect(container.querySelector(".bk-settings-stack")).not.toBeNull();
  expect(container.querySelectorAll(".bk-settings-card")).toHaveLength(2);
  expect(strategyHeading.closest(".bk-settings-card")).not.toBeNull();
  expect(providerHeading.closest(".bk-settings-card")).not.toBeNull();
  expect(container.querySelectorAll(".bk-settings-toggle-list")).toHaveLength(1);
  expect(container.querySelectorAll(".bk-settings-toggle-row")).toHaveLength(2);
  expect(container.querySelectorAll(".bk-settings-field-grid")).toHaveLength(3);

  expect(screen.getByRole("switch", { name: "启用 AI 服务" })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "用 AI 补查书目信息" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "OpenAI" })).toBeNull();
  expect(screen.queryByRole("button", { name: /保存策略|保存平台/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "自定义模型 ID" })).toBeNull();

  expect(screen.getByRole("combobox", { name: "模型预设" })).toBeInTheDocument();
  expect(screen.getByText("填写凭证后自动获取，或选择自定义模型")).toBeInTheDocument();
  expect(screen.getByText("填写接口地址与 API 密钥后可自动获取可用模型，或选择自定义模型手动输入。")).toBeInTheDocument();
  expect(screen.queryByText("GPT-4o mini")).toBeNull();
  expect(screen.queryByText("deepseek-flash")).toBeNull();
  expect(api.listAiProviderModels).not.toHaveBeenCalled();

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "模型预设" }));
  expect(await screen.findByText("自定义模型")).toBeInTheDocument();
  expect(screen.queryByText("GPT-5.2")).toBeNull();

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "选择厂商" }));
  fireEvent.click(await screen.findByText("DeepSeek"));
  expect(screen.getByText("填写凭证后自动获取，或选择自定义模型")).toBeInTheDocument();
  expect(screen.queryByText("deepseek-flash")).toBeNull();
  await waitFor(() => expect(api.getAiSettings).toHaveBeenCalledTimes(1));
});

it("auto-saves immediately when switching the active provider or toggling strategy switches", async () => {
  render(<TestProviders><AiSettingsPage /></TestProviders>);
  await screen.findByRole("textbox", { name: "显示名称" });
  expect(screen.queryByRole("switch", { name: /^启用$/ })).toBeNull();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "选择厂商" }));
  fireEvent.click(await screen.findByText("DeepSeek"));
  await waitFor(() => expect(api.updateAiSettings).toHaveBeenCalledWith(expect.objectContaining({
    providers: expect.arrayContaining([
      expect.objectContaining({ id: "openai", enabled: false }),
      expect.objectContaining({ id: "deepseek", enabled: true }),
      expect.objectContaining({ id: "zhipu", enabled: false }),
    ]),
  })));
  expect(await screen.findByRole("status")).toHaveTextContent("已自动保存");

  fireEvent.click(screen.getByRole("switch", { name: "启用 AI 服务" }));
  await waitFor(() => expect(api.updateAiSettings).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true })));
});

it("discovers live models automatically for local endpoints and auto-saves chosen model", async () => {
  vi.mocked(api.listAiProviderModels).mockResolvedValue({
    models: [
      { id: "qwen3:14b", label: "qwen3:14b" },
      { id: "llama3.3:latest", label: "llama3.3:latest" },
    ],
    source: "ollama",
  });
  render(<TestProviders><AiSettingsPage /></TestProviders>);
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: "选择厂商" }));
  fireEvent.click(await screen.findByText("Ollama（本地）"));

  await waitFor(() => expect(api.listAiProviderModels).toHaveBeenCalledWith({
    id: "ollama",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "http://127.0.0.1:11434/v1",
  }));

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "模型预设" }));
  fireEvent.click((await screen.findAllByText("qwen3:14b")).at(-1)!);
  await waitFor(() => expect(api.updateAiSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    providers: expect.arrayContaining([
      expect.objectContaining({ id: "ollama", enabled: true, model: "qwen3:14b" }),
    ]),
  })));
});

it("fetches available models on blur after entering API key and auto-saves selected model", async () => {
  vi.mocked(api.listAiProviderModels).mockResolvedValue({
    models: [{ id: "gpt-5.2", label: "GPT-5.2" }],
    source: "openai",
  });
  render(<TestProviders><AiSettingsPage /></TestProviders>);
  const keyInput = await screen.findByLabelText("API 密钥");
  fireEvent.change(keyInput, { target: { value: "sk-live-key" } });
  fireEvent.blur(keyInput);
  await waitFor(() => expect(api.listAiProviderModels).toHaveBeenCalledWith({
    id: "openai",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-live-key",
  }));

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "模型预设" }));
  fireEvent.click(await screen.findByText("GPT-5.2"));
  await waitFor(() => expect(api.updateAiSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    providers: expect.arrayContaining([
      expect.objectContaining({ id: "openai", enabled: true, model: "gpt-5.2" }),
    ]),
  })));
});

it("shows fallback hints when live model discovery returns empty or fails", async () => {
  vi.mocked(api.listAiProviderModels)
    .mockResolvedValueOnce({ models: [], source: "empty" })
    .mockRejectedValueOnce(new Error("network error"));

  render(<TestProviders><AiSettingsPage /></TestProviders>);
  const keyInput = await screen.findByLabelText("API 密钥");
  fireEvent.change(keyInput, { target: { value: "sk-empty" } });
  fireEvent.blur(keyInput);
  expect(await screen.findByText("未获取到可用模型，可选择自定义模型手动输入模型 ID。")).toBeInTheDocument();

  fireEvent.change(keyInput, { target: { value: "sk-error" } });
  fireEvent.blur(keyInput);
  expect(await screen.findByText("未能获取实时模型列表，可选择自定义模型手动输入模型 ID。")).toBeInTheDocument();
});

it("triggers model discovery on saved credentials and auto-saves custom model ID on blur", async () => {
  vi.mocked(api.getAiSettings).mockResolvedValue({
    ...settings,
    providers: settings.providers.map((provider) => (provider.id === "zhipu" ? { ...provider, apiKeyConfigured: true } : provider)),
  });
  vi.mocked(api.listAiProviderModels).mockResolvedValue({
    models: [{ id: "glm-5.1", label: "GLM-5.1" }],
    source: "zhipu",
  });
  render(<TestProviders><AiSettingsPage /></TestProviders>);

  fireEvent.mouseDown(await screen.findByRole("combobox", { name: "选择厂商" }));
  fireEvent.click(await screen.findByText("智谱"));
  expect(screen.getByRole("textbox", { name: "接口地址" })).toHaveValue("https://open.bigmodel.cn/api/paas/v4/");
  expect(screen.getByLabelText("API 密钥")).toHaveValue("");
  await waitFor(() => expect(api.listAiProviderModels).toHaveBeenCalledWith({
    id: "zhipu",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
  }));

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "模型预设" }));
  fireEvent.click(await screen.findByText("自定义模型"));
  const customInput = await screen.findByRole("textbox", { name: "自定义模型 ID" });
  fireEvent.change(customInput, { target: { value: "glm-custom" } });
  fireEvent.blur(customInput);
  await waitFor(() => expect(api.updateAiSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    providers: expect.arrayContaining([
      expect.objectContaining({ id: "zhipu", enabled: true, model: "glm-custom", apiKey: "", clearApiKey: false }),
    ]),
  })));
});

it("restores the saved enabled provider and saved model on load", async () => {
  vi.mocked(api.getAiSettings).mockResolvedValue({
    ...settings,
    providers: settings.providers.map((provider) => (
      provider.id === "deepseek" ? { ...provider, enabled: true, model: "saved-custom-model" } : provider
    )),
  });
  render(<TestProviders><AiSettingsPage /></TestProviders>);
  expect(await screen.findByDisplayValue("DeepSeek")).toBeInTheDocument();
  expect(screen.getByText("saved-custom-model")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "自定义模型 ID" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "OpenAI" })).toBeNull();
});
