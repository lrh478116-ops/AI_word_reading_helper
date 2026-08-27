import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

function executableCandidates() {
  const explicit = String(process.env.AI_TIP_OLLAMA_EXECUTABLE || "").trim();
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (process.platform === "win32") {
    return [
      explicit,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe") : "",
      ...pathEntries.map((entry) => path.join(entry, "ollama.exe"))
    ].filter(Boolean);
  }
  return [
    explicit,
    "/Applications/Ollama.app/Contents/Resources/ollama",
    "/usr/local/bin/ollama",
    "/opt/homebrew/bin/ollama",
    ...pathEntries.map((entry) => path.join(entry, "ollama"))
  ].filter(Boolean);
}

export function findOllamaExecutable() {
  return executableCandidates().find((candidate) => existsSync(candidate)) || "";
}

export function defaultOllamaModelsPath() {
  if (process.platform === "linux") return "/usr/share/ollama/.ollama/models";
  return path.join(os.homedir(), ".ollama", "models");
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("无法分配本地 Ollama 端口")); return; }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function diskFreeBytes(directory) {
  try {
    const stats = statfsSync(directory, { bigint: true });
    return Number(stats.bavail * stats.bsize);
  } catch { return 0; }
}

function comparablePath(value) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertGgufFile(modelPath) {
  if (!path.isAbsolute(modelPath)) throw new Error("GGUF 模型路径必须是绝对路径");
  const resolved = path.resolve(modelPath);
  let handle;
  try {
    const stats = statSync(resolved);
    if (!stats.isFile() || stats.size < 8) throw new Error("文件为空或不是普通文件");
    handle = openSync(resolved, "r");
    const magic = Buffer.alloc(4);
    if (readSync(handle, magic, 0, 4, 0) !== 4 || magic.toString("ascii") !== "GGUF") throw new Error("文件头不是 GGUF");
  } catch (error) {
    throw new Error(`无法使用所选 GGUF 模型：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
  return resolved;
}

export class BundledLlamaRuntime {
  constructor({ configPath, helperPath, spawnRuntime = spawn, fetchRuntime = fetch, portAllocator = freeLoopbackPort }) {
    this.configPath = configPath;
    this.helperPath = path.resolve(helperPath || "");
    this.spawnRuntime = spawnRuntime;
    this.fetchRuntime = fetchRuntime;
    this.portAllocator = portAllocator;
    this.child = null;
    this.directory = "";
    this.origin = "";
    this.modelPath = "";
    this.modelId = "";
  }

  readConfig() {
    try {
      const value = JSON.parse(readFileSync(this.configPath, "utf8"));
      if (typeof value?.modelPath !== "string" || !path.isAbsolute(value.modelPath) || typeof value?.modelId !== "string" || !value.modelId.trim()) return null;
      return { modelPath: path.resolve(value.modelPath), modelId: value.modelId.trim() };
    } catch { return null; }
  }

  persist(modelPath, modelId) {
    mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 2, runtime: "llama.cpp", modelPath, modelId, updatedAt: new Date().toISOString() }, null, 2), "utf8");
    if (existsSync(this.configPath)) rmSync(this.configPath, { force: true });
    renameSync(temporary, this.configPath);
  }

  prepareDirectory(directory) {
    if (!path.isAbsolute(directory)) throw new Error("模型目录必须是绝对路径");
    const resolved = path.resolve(directory);
    mkdirSync(resolved, { recursive: true });
    this.directory = resolved;
    return { directory: resolved, freeBytes: diskFreeBytes(resolved), runtime: "llama.cpp", managed: true };
  }

  info() {
    return {
      reachable: Boolean(this.child && this.child.exitCode === null && this.origin),
      origin: this.origin,
      version: "llama.cpp-b10545",
      runtime: "llama.cpp",
      storagePath: this.directory || (this.modelPath ? path.dirname(this.modelPath) : ""),
      storagePathSource: this.directory || this.modelPath ? "user-selected" : "platform-default",
      installedModels: this.modelId ? [this.modelId] : [],
      totalRamBytes: os.totalmem(),
      modelId: this.modelId,
      modelPath: this.modelPath,
      helperPath: this.helperPath
    };
  }

  async restore() {
    const saved = this.readConfig();
    if (!saved || !existsSync(saved.modelPath)) return null;
    return this.activateModel(saved.modelPath, saved.modelId, { persist: false });
  }

  async activateModel(modelPath, modelId, { persist = true } = {}) {
    if (!existsSync(this.helperPath)) throw new Error("内置 llama.cpp 运行时缺失；请重新安装完整版本的 AI Tip");
    const resolvedModel = assertGgufFile(modelPath);
    const resolvedId = String(modelId || "").trim();
    if (!resolvedId || resolvedId.length > 200) throw new Error("本地模型 ID 无效");
    if (this.child && this.child.exitCode === null && comparablePath(this.modelPath) === comparablePath(resolvedModel) && this.modelId === resolvedId) return this.info();
    await this.stop();
    const port = await this.portAllocator();
    const origin = `http://127.0.0.1:${port}`;
    const args = ["-m", resolvedModel, "--host", "127.0.0.1", "--port", String(port), "--alias", resolvedId, "--no-webui", "--ctx-size", "8192", "--parallel", "1"];
    const child = this.spawnRuntime(this.helperPath, args, { env: { ...process.env }, windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;
    this.directory = path.dirname(resolvedModel);
    this.origin = origin;
    this.modelPath = resolvedModel;
    this.modelId = resolvedId;
    let stderr = "";
    let spawnError = "";
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
    child.once("error", (error) => { spawnError = error.message; });
    const deadline = Date.now() + 90_000;
    let lastError = "";
    while (Date.now() < deadline) {
      if (spawnError) { await this.stop(); throw new Error(`无法启动内置 llama.cpp：${spawnError}`); }
      if (child.exitCode !== null) { const exit = child.exitCode; await this.stop(); throw new Error(`内置 llama.cpp 加载模型失败（退出码 ${exit}）${stderr ? `：${stderr.trim()}` : ""}`); }
      try {
        const response = await this.fetchRuntime(`${origin}/v1/models`, { signal: AbortSignal.timeout(1_500) });
        if (response.ok) {
          const body = await response.json();
          const ids = Array.isArray(body?.data) ? body.data.map((item) => String(item?.id || "")) : [];
          if (ids.includes(resolvedId)) {
            if (persist) this.persist(resolvedModel, resolvedId);
            return this.info();
          }
          lastError = "运行时未返回目标模型别名";
        } else lastError = `/v1/models 返回 ${response.status}`;
      } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    await this.stop();
    throw new Error(`内置 llama.cpp 加载模型超时${lastError ? `：${lastError}` : ""}${stderr ? `；${stderr.trim()}` : ""}`);
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.origin = "";
    if (!child || child.exitCode !== null) return;
    child.kill();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

export class ManagedOllamaRuntime {
  constructor({ configPath, isMas = false, spawnRuntime = spawn, fetchRuntime = fetch, portAllocator = freeLoopbackPort, executableResolver = findOllamaExecutable }) {
    this.configPath = configPath;
    this.isMas = isMas;
    this.spawnRuntime = spawnRuntime;
    this.fetchRuntime = fetchRuntime;
    this.portAllocator = portAllocator;
    this.executableResolver = executableResolver;
    this.child = null;
    this.directory = "";
    this.origin = "";
  }

  readConfig() {
    try {
      const value = JSON.parse(readFileSync(this.configPath, "utf8"));
      return typeof value?.directory === "string" && path.isAbsolute(value.directory) ? { directory: path.resolve(value.directory) } : null;
    } catch { return null; }
  }

  persist(directory) {
    mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, directory, updatedAt: new Date().toISOString() }, null, 2), "utf8");
    if (existsSync(this.configPath)) rmSync(this.configPath, { force: true });
    renameSync(temporary, this.configPath);
  }

  async restore() {
    const saved = this.readConfig();
    if (!saved || this.isMas) return null;
    return this.activate(saved.directory, { persist: false });
  }

  async activate(directory, { persist = true } = {}) {
    if (!path.isAbsolute(directory)) throw new Error("模型目录必须是绝对路径");
    const resolved = path.resolve(directory);
    mkdirSync(resolved, { recursive: true });
    if (this.child && this.child.exitCode === null && comparablePath(this.directory) === comparablePath(resolved)) {
      return { directory: this.directory, origin: this.origin, executable: this.executableResolver(), freeBytes: diskFreeBytes(resolved), managed: true };
    }
    if (this.isMas) {
      if (comparablePath(resolved) !== comparablePath(defaultOllamaModelsPath())) throw new Error("Mac App Store 沙箱不能启动外部 Ollama 来切换自定义模型目录；请在 Ollama 中配置目录并重新启动后再下载。");
      process.env.OLLAMA_MODELS = resolved;
      process.env.AI_TIP_MODEL_DIRECTORY_SOURCE = "user-selected";
      return { directory: resolved, origin: process.env.AI_TIP_OLLAMA_ORIGIN || "http://127.0.0.1:11434", executable: "", freeBytes: diskFreeBytes(resolved), managed: false };
    }

    const executable = this.executableResolver();
    if (!executable) throw new Error("未找到 Ollama CLI。请先安装 Ollama，再返回选择模型目录。");
    await this.stop();
    const port = await this.portAllocator();
    const origin = `http://127.0.0.1:${port}`;
    const child = this.spawnRuntime(executable, ["serve"], {
      env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: resolved },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"]
    });
    this.child = child;
    this.directory = resolved;
    this.origin = origin;
    let stderr = "";
    let spawnError = "";
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-2000); });
    child.once("error", (error) => { spawnError = error.message; });

    const deadline = Date.now() + 25_000;
    let lastError = "";
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`无法启动 Ollama CLI：${spawnError}`);
      if (child.exitCode !== null) throw new Error(`Ollama 受管运行时启动失败（退出码 ${child.exitCode}）${stderr ? `：${stderr.trim()}` : ""}`);
      try {
        const response = await this.fetchRuntime(`${origin}/api/tags`, { signal: AbortSignal.timeout(1_500) });
        if (response.ok) {
          process.env.OLLAMA_MODELS = resolved;
          process.env.AI_TIP_MODEL_DIRECTORY_SOURCE = "user-selected";
          process.env.AI_TIP_OLLAMA_ORIGIN = origin;
          if (persist) this.persist(resolved);
          return { directory: resolved, origin, executable, freeBytes: diskFreeBytes(resolved), managed: true };
        }
        lastError = `/api/tags 返回 ${response.status}`;
      } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    await this.stop();
    throw new Error(`Ollama 受管运行时启动超时${lastError ? `：${lastError}` : ""}${stderr ? `；${stderr.trim()}` : ""}`);
  }

  async info() {
    const executable = this.executableResolver();
    const origin = this.origin || process.env.AI_TIP_OLLAMA_ORIGIN || "http://127.0.0.1:11434";
    const directory = this.directory || this.readConfig()?.directory || defaultOllamaModelsPath();
    const base = { reachable: false, origin, version: "", runtime: "ollama", storagePath: directory, storagePathSource: this.directory || this.readConfig()?.directory ? "user-selected" : "platform-default", installedModels: [], totalRamBytes: os.totalmem(), executable, managed: Boolean(this.child && this.child.exitCode === null) };
    if (!executable && !this.isMas) return { ...base, error: "未找到 Ollama CLI" };
    try {
      const [versionResponse, tagsResponse] = await Promise.all([
        this.fetchRuntime(`${origin}/api/version`, { signal: AbortSignal.timeout(2_500) }),
        this.fetchRuntime(`${origin}/api/tags`, { signal: AbortSignal.timeout(2_500) })
      ]);
      if (!tagsResponse.ok) throw new Error(`/api/tags 返回 ${tagsResponse.status}`);
      const tags = await tagsResponse.json();
      const version = versionResponse.ok ? String((await versionResponse.json())?.version || "") : "";
      const installedModels = Array.isArray(tags?.models) ? tags.models.map((item) => String(item?.name || item?.model || "")).filter(Boolean) : [];
      return { ...base, reachable: true, version, installedModels };
    } catch (error) { return { ...base, error: error instanceof Error ? error.message : String(error) }; }
  }

  async pull(modelRef, { signal, onProgress = () => undefined } = {}) {
    const requested = String(modelRef || "").trim();
    if (!/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/i.test(requested) || requested.length > 240) throw new Error("Ollama 模型引用无效");
    if (!this.origin) throw new Error("Ollama 受管运行时尚未通过模型目录授权");
    const response = await this.fetchRuntime(`${this.origin}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: requested, stream: true }),
      signal
    });
    if (!response.ok || !response.body) throw new Error(`Ollama /api/pull 返回 ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let last = {};
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(String(event.error));
        last = event;
        onProgress({ type: "progress", status: String(event.status || "downloading"), completed: Number(event.completed || 0), total: Number(event.total || 0), networkStack: "ollama-client", initialHost: "registry.ollama.ai", finalHost: "registry.ollama.ai", proxyDescription: "Ollama CLI" });
      }
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      if (event.error) throw new Error(String(event.error));
      last = event;
    }
    const runtime = await this.info();
    if (!runtime.reachable || !runtime.installedModels.some((name) => name === requested || name.startsWith(`${requested}:`))) throw new Error("Ollama 下载结束，但 /api/tags 未确认目标模型");
    return { runtime, event: last };
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.directory = "";
    this.origin = "";
    if (!child || child.exitCode !== null) return;
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
