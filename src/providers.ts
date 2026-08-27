import type { ApiProvider } from "./types.js";

export const PROVIDER_REGISTRY_VERSION = 3;
export const PROVIDER_REGISTRY_VERIFIED_AT = "2026-08-21";

export interface ProviderDefinition {
  id: ApiProvider;
  labelKey: string;
  baseURL: string;
  defaultModel: string;
  legacyDefaultModels: string[];
  retiredModels: string[];
  supportsModelList: boolean;
  local: boolean;
}

export const PROVIDER_REGISTRY: Record<ApiProvider, ProviderDefinition> = {
  openai: {
    id: "openai", labelKey: "provider.openai", baseURL: "https://api.openai.com/v1", defaultModel: "gpt-5.6-terra",
    legacyDefaultModels: ["gpt-5-mini"], retiredModels: [], supportsModelList: true, local: false
  },
  deepseek: {
    id: "deepseek", labelKey: "provider.deepseek", baseURL: "https://api.deepseek.com", defaultModel: "deepseek-v4-flash",
    legacyDefaultModels: ["deepseek-chat", "deepseek-reasoner"], retiredModels: ["deepseek-chat", "deepseek-reasoner"], supportsModelList: true, local: false
  },
  siliconflow: {
    id: "siliconflow", labelKey: "provider.siliconflow", baseURL: "https://api.siliconflow.cn/v1", defaultModel: "deepseek-ai/DeepSeek-V3.2",
    legacyDefaultModels: ["deepseek-ai/DeepSeek-V3"], retiredModels: [], supportsModelList: true, local: false
  },
  moonshot: {
    id: "moonshot", labelKey: "provider.moonshot", baseURL: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2.6",
    legacyDefaultModels: ["moonshot-v1-8k"], retiredModels: [], supportsModelList: true, local: false
  },
  zhipu: {
    id: "zhipu", labelKey: "provider.zhipu", baseURL: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-5.2",
    legacyDefaultModels: ["glm-4-flash"], retiredModels: [], supportsModelList: true, local: false
  },
  gemini: {
    id: "gemini", labelKey: "provider.gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-3.6-flash",
    legacyDefaultModels: ["gemini-2.5-flash"], retiredModels: [], supportsModelList: true, local: false
  },
  local: {
    id: "local", labelKey: "provider.local", baseURL: "http://127.0.0.1:8080/v1", defaultModel: "aitip:local-gguf",
    legacyDefaultModels: [], retiredModels: [], supportsModelList: true, local: true
  },
  ollama: {
    id: "ollama", labelKey: "provider.ollama", baseURL: "http://127.0.0.1:11434/v1", defaultModel: "qwen3.5:9b",
    legacyDefaultModels: ["qwen3:8b"], retiredModels: [], supportsModelList: true, local: true
  },
  custom: {
    id: "custom", labelKey: "provider.custom", baseURL: "", defaultModel: "",
    legacyDefaultModels: [], retiredModels: [], supportsModelList: true, local: false
  }
};

export function providerDefinition(value: unknown): ProviderDefinition {
  return PROVIDER_REGISTRY[Object.hasOwn(PROVIDER_REGISTRY, String(value)) ? value as ApiProvider : "openai"];
}

export function migrateProviderPreset(input: { provider: ApiProvider; baseURL: string; model: string }) {
  const definition = providerDefinition(input.provider);
  if (input.provider === "custom" || input.provider === "local" || input.provider === "ollama") return { ...input, changed: false };
  const normalizedBaseURL = String(input.baseURL || "").replace(/\/+$/, "");
  const builtInURL = definition.baseURL.replace(/\/+$/, "");
  if (normalizedBaseURL !== builtInURL || !definition.legacyDefaultModels.includes(input.model)) return { ...input, changed: false };
  return { ...input, baseURL: definition.baseURL, model: definition.defaultModel, changed: true };
}
