import { expect, it } from "vitest";
import { api } from "./client";

it("includes Zhipu as a disabled demo default without a key or preset model", async () => {
  expect(api.isDemo).toBe(true);
  const settings = await api.getAiSettings();
  expect(settings.providers.every(provider => provider.model === "")).toBe(true);
  expect(settings.providers.find(provider => provider.id === "zhipu")).toMatchObject({
    label: "智谱",
    type: "OPENAI_COMPATIBLE",
    enabled: false,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
    model: "",
    apiKeyConfigured: false,
  });
});
