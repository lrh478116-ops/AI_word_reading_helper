export {};

declare global {
  interface Window {
    aiTipDesktop?: {
      copyText: (value: string) => Promise<{ copied: boolean }>;
      loadRememberedLogin: () => Promise<{ available: boolean; credentials: { email: string; password: string } | null }>;
      saveRememberedLogin: (email: string, password: string) => Promise<{ saved: boolean; email: string }>;
      clearRememberedLogin: () => Promise<{ cleared: boolean }>;
      getOllamaStatus: () => Promise<{ installed: boolean; executable: string; platform: string; supported: boolean; mas: boolean; installer: { version: string; assetName: string; size: number; sha256: string; startUrl: string } | null }>;
      chooseOllamaInstallerDestination: () => Promise<{ canceled: boolean; path?: string; selectionToken?: string }>;
      downloadOllamaInstaller: (requestId: string, selectionToken: string) => Promise<{ ok: boolean; opened: boolean; finalPath: string; version: string; size: number; sha256: string }>;
      cancelOllamaInstaller: (requestId: string) => Promise<{ canceled: boolean }>;
      onOllamaInstallerProgress: (listener: (event: { requestId: string; type: string; status: string; completed: number; total: number; networkStack: string; initialHost: string; finalHost: string; proxyDescription: string }) => void) => () => void;
      chooseModelDirectory: (suggestedPath?: string, runtimeKind?: "llama.cpp" | "ollama") => Promise<{ canceled: boolean; path?: string; selectionToken?: string }>;
      prepareModelDirectory: (selectionToken: string) => Promise<{ directory: string; freeBytes: number; runtime: "llama.cpp" | "ollama"; managed: boolean }>;
      chooseLocalModelFile: (modelId: string) => Promise<{ canceled: boolean; runtime?: import("./local-models").LocalRuntimeInfo }>;
    };
  }
}
