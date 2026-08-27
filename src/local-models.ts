export type LocalModelTier = "ultralight" | "light" | "sweet-spot" | "high-end";
export type LocalModelSourceKind = "modelscope" | "huggingface" | "ollama";

export interface LocalModelArtifact {
  repository: string;
  revision: string;
  filename: string;
  sha256: string;
  size: number;
}

export interface LocalModelSource {
  id: LocalModelSourceKind;
  labelZh: string;
  labelEn: string;
  modelRef: string;
  evidenceUrl: string;
  artifact?: LocalModelArtifact;
}

export interface LocalModelCatalogItem {
  id: string;
  tier: LocalModelTier;
  name: string;
  quantization: string;
  approxBytes: number;
  ram: string;
  gpu: string;
  featuresZh: string;
  featuresEn: string;
  recommended?: boolean;
  sources: LocalModelSource[];
}

export interface LocalRuntimeInfo {
  reachable: boolean;
  origin: string;
  version: string;
  storagePath: string;
  storagePathSource: "user-selected" | "environment" | "platform-default";
  installedModels: string[];
  totalRamBytes: number;
  runtime: "llama.cpp" | "ollama" | "unavailable";
  modelId?: string;
  modelPath?: string;
  error?: string;
}

/** @deprecated compatibility name for older callers. */
export type OllamaRuntimeInfo = LocalRuntimeInfo;

const ollamaSource = (modelRef: string, evidenceUrl: string): LocalModelSource => ({
  id: "ollama", labelZh: "Ollama 官方库", labelEn: "Ollama library", modelRef, evidenceUrl
});
const hfSource = (artifact: LocalModelArtifact, evidenceUrl: string): LocalModelSource => ({
  id: "huggingface", labelZh: "Hugging Face 官方仓库", labelEn: "Hugging Face official repository", modelRef: `aitip:${artifact.repository.split("/").at(-1)?.replace(/-gguf$/i, "").toLowerCase()}`, evidenceUrl, artifact
});
const modelscopeSource = (artifact: LocalModelArtifact, evidenceUrl: string): LocalModelSource => ({
  id: "modelscope", labelZh: "ModelScope 官方仓库（国内）", labelEn: "ModelScope official repository (China)", modelRef: `aitip:${artifact.repository.split("/").at(-1)?.replace(/-gguf$/i, "").toLowerCase()}`, evidenceUrl, artifact
});

export const LOCAL_MODEL_CATALOG_VERIFIED_AT = "2026-08-21";

const minicpm5Artifact: LocalModelArtifact = { repository: "openbmb/MiniCPM5-1B-GGUF", revision: "3d55fac80935ae6456986ad2384b5cbcc4d6c948", filename: "MiniCPM5-1B-Q4_K_M.gguf", sha256: "81b64d05a23b17b34c475f42b3e72fbde62d4b92cc34541f7a8031d0752deafa", size: 688_065_920 };
const minicpm5ModelScopeArtifact: LocalModelArtifact = { ...minicpm5Artifact, repository: "OpenBMB/MiniCPM5-1B-GGUF", revision: "master" };
const smollm3Artifact: LocalModelArtifact = { repository: "ggml-org/SmolLM3-3B-GGUF", revision: "4965cb60b150737b68a0408c36aeefb65078f894", filename: "SmolLM3-Q4_K_M.gguf", sha256: "8334b850b7bd46238c16b0c550df2138f0889bf433809008cc17a8b05761863e", size: 1_915_305_312 };
const minicpm41Artifact: LocalModelArtifact = { repository: "openbmb/MiniCPM4.1-8B-GGUF", revision: "ebb834d0ad9acfa98bd16bc963ec51be5f7e08c1", filename: "MiniCPM4.1-8B-Q4_K_M.gguf", sha256: "9d2ffb9145bf7a88ddb94b2542b42d925293666c42962aa158eeb62fc9708654", size: 4_965_526_048 };
const internlm3Artifact: LocalModelArtifact = { repository: "internlm/internlm3-8b-instruct-gguf", revision: "da5c6e82dacd20a4914fd304658e17d119b02ed5", filename: "internlm3-8b-instruct-q4_k_m.gguf", sha256: "e7b10f95f20a5c5a8e6213925c88bc6b02012e41c0c7d7da0b0788c528c0e010", size: 5_358_623_936 };

export const LOCAL_MODEL_CATALOG: LocalModelCatalogItem[] = [
  {
    id: "minicpm5-1b", tier: "ultralight", name: "MiniCPM5-1B", quantization: "Q4_K_M", approxBytes: 688_000_000,
    ram: "8GB", gpu: "无需", recommended: true,
    featuresZh: "中文、工具调用、代码与混合推理能力突出，低配置首选。",
    featuresEn: "Strong Chinese, tool use, code, and hybrid reasoning in a very small footprint.",
    sources: [
      modelscopeSource(minicpm5ModelScopeArtifact, "https://www.modelscope.cn/models/OpenBMB/MiniCPM5-1B-GGUF"),
      hfSource(minicpm5Artifact, "https://huggingface.co/openbmb/MiniCPM5-1B-GGUF"),
      ollamaSource("openbmb/minicpm5:q4_K_M", "https://ollama.com/openbmb/minicpm5")
    ]
  },
  {
    id: "llama-3.2-1b", tier: "ultralight", name: "Llama 3.2 1B", quantization: "Q4_K_M", approxBytes: 808_000_000,
    ram: "8GB", gpu: "无需",
    featuresZh: "英文生态成熟，适合摘要、改写和端侧任务；中文不是官方重点支持语言。",
    featuresEn: "Mature English ecosystem for summarization, rewriting, and edge tasks.",
    sources: [ollamaSource("llama3.2:1b-instruct-q4_K_M", "https://ollama.com/library/llama3.2/tags")]
  },
  {
    id: "gemma-4-e2b", tier: "light", name: "Gemma 4 E2B", quantization: "Q4_K_M", approxBytes: 7_200_000_000,
    ram: "16GB", gpu: "6GB+",
    featuresZh: "端侧 MoE、图文理解、思考模式和工具调用；E2B 是有效参数量，不是总参数量。",
    featuresEn: "Edge-oriented MoE with vision, thinking modes, and tools; E2B means effective parameters.",
    sources: [ollamaSource("gemma4:e2b", "https://ollama.com/library/gemma4:e2b")]
  },
  {
    id: "smollm3-3b", tier: "light", name: "SmolLM3 3B", quantization: "Q4_K_M", approxBytes: 1_915_305_312,
    ram: "8GB", gpu: "无需",
    featuresZh: "Apache 2.0、开放 GGUF、长上下文；中文能力相对有限。",
    featuresEn: "Apache 2.0, open GGUF, and long context; comparatively weaker Chinese.",
    sources: [
      hfSource(smollm3Artifact, "https://huggingface.co/ggml-org/SmolLM3-3B-GGUF")
    ]
  },
  {
    id: "llama-3.2-3b", tier: "light", name: "Llama 3.2 3B", quantization: "Q4_K_M", approxBytes: 2_000_000_000,
    ram: "8GB", gpu: "无需",
    featuresZh: "指令遵循、摘要、提示词改写与工具生态成熟。",
    featuresEn: "Mature instruction following, summarization, prompt rewriting, and tooling ecosystem.",
    sources: [ollamaSource("llama3.2:3b-instruct-q4_K_M", "https://ollama.com/library/llama3.2/tags")]
  },
  {
    id: "phi-4-mini-3.8b", tier: "sweet-spot", name: "Phi-4-mini 3.8B", quantization: "Q4_K_M", approxBytes: 2_500_000_000,
    ram: "16GB", gpu: "4GB+",
    featuresZh: "数学、逻辑、推理和 Windows 本地生态较好，支持工具调用。",
    featuresEn: "Strong math, logic, reasoning, Windows support, and tool calling.",
    sources: [ollamaSource("phi4-mini:3.8b", "https://ollama.com/library/phi4-mini:3.8b")]
  },
  {
    id: "qwen3.5-4b", tier: "sweet-spot", name: "Qwen3.5-4B", quantization: "Q4_K_M", approxBytes: 3_400_000_000,
    ram: "16GB", gpu: "4–6GB+", recommended: true,
    featuresZh: "中文、多语言、Agent、视觉、工具调用与思考模式均衡。",
    featuresEn: "Balanced Chinese and multilingual ability, agents, vision, tools, and thinking modes.",
    sources: [ollamaSource("qwen3.5:4b", "https://ollama.com/library/qwen3.5:4b")]
  },
  {
    id: "gemma-4-e4b", tier: "sweet-spot", name: "Gemma 4 E4B", quantization: "Q4_K_M", approxBytes: 9_600_000_000,
    ram: "16–32GB", gpu: "8GB+",
    featuresZh: "更高有效容量的端侧 MoE，图文、推理、代码和 Agent 能力均衡。",
    featuresEn: "Higher-capacity edge MoE with balanced vision, reasoning, code, and agent capabilities.",
    sources: [ollamaSource("gemma4:e4b", "https://ollama.com/library/gemma4:e4b")]
  },
  {
    id: "minicpm4.1-8b", tier: "high-end", name: "MiniCPM4.1-8B", quantization: "Q4_K_M", approxBytes: 5_000_000_000,
    ram: "16–32GB", gpu: "8GB",
    featuresZh: "中文端侧效率高，支持混合思考与非思考模式。",
    featuresEn: "Efficient on-device model with hybrid thinking and non-thinking modes.",
    sources: [
      hfSource(minicpm41Artifact, "https://huggingface.co/openbmb/MiniCPM4.1-8B-GGUF"),
      ollamaSource("openbmb/minicpm4.1", "https://ollama.com/openbmb/minicpm4.1")
    ]
  },
  {
    id: "internlm3-8b", tier: "high-end", name: "InternLM3-8B", quantization: "Q4_K_M", approxBytes: 5_358_623_936,
    ram: "16–32GB", gpu: "8GB",
    featuresZh: "中文、通用任务与深度推理能力较强；使用官方 Hugging Face GGUF。",
    featuresEn: "Strong Chinese, general-purpose tasks, and deep reasoning via the official Hugging Face GGUF.",
    sources: [
      hfSource(internlm3Artifact, "https://huggingface.co/internlm/internlm3-8b-instruct-gguf")
    ]
  },
  {
    id: "gemma-4-12b", tier: "high-end", name: "Gemma 4 12B", quantization: "Q4_K_M", approxBytes: 7_600_000_000,
    ram: "32GB", gpu: "8–12GB",
    featuresZh: "更高推理、代码、Agent 与多模态能力，适合高配置设备。",
    featuresEn: "Higher reasoning, coding, agent, and multimodal capability for powerful systems.",
    sources: [ollamaSource("gemma4:12b", "https://ollama.com/library/gemma4:12b")]
  }
];

export function localModelById(id: unknown) {
  return LOCAL_MODEL_CATALOG.find((item) => item.id === String(id || ""));
}

export function localModelSource(model: LocalModelCatalogItem, id: unknown) {
  return model.sources.find((source) => source.id === String(id || ""));
}
