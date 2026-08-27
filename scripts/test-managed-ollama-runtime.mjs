import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ManagedOllamaRuntime, defaultOllamaModelsPath } from "../electron/model-runtime.mjs";

const temporary = await mkdtemp(path.join(os.tmpdir(), "ai-tip-managed-ollama-"));
const configPath = path.join(temporary, "managed-ollama.json");
const selectedDirectory = path.join(temporary, "models with spaces");
const spawns = [];
let fakeInstalledModels = [];

function fakeSpawn(executable, args, options) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.stderr = new EventEmitter();
  child.kill = (signal = "SIGTERM") => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  spawns.push({ executable, args, options, child });
  return child;
}

const dependencies = {
  spawnRuntime: fakeSpawn,
  fetchRuntime: async (url, init = {}) => {
    if (url === "http://127.0.0.1:32123/api/tags") return new Response(JSON.stringify({ models: fakeInstalledModels.map((name) => ({ name, model: name })) }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url === "http://127.0.0.1:32123/api/version") return new Response(JSON.stringify({ version: "test-version" }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url === "http://127.0.0.1:32123/api/pull" && init.method === "POST") {
      const model = JSON.parse(init.body).name;
      fakeInstalledModels = [model];
      return new Response(`${JSON.stringify({ status: "pulling manifest", completed: 1, total: 2 })}\n${JSON.stringify({ status: "success", completed: 2, total: 2 })}\n`, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    }
    return new Response("not found", { status: 404 });
  },
  portAllocator: async () => 32123,
  executableResolver: () => process.platform === "win32" ? "C:\\fake\\ollama.exe" : "/fake/ollama"
};

try {
  const runtime = new ManagedOllamaRuntime({ configPath, ...dependencies });
  const activated = await runtime.activate(selectedDirectory);
  if (!activated.managed || activated.directory !== path.resolve(selectedDirectory) || activated.origin !== "http://127.0.0.1:32123" || spawns.length !== 1) throw new Error(`受管 Ollama 没有启动到所选目录：${JSON.stringify({ activated, spawns: spawns.length })}`);
  const spawnCall = spawns[0];
  if (spawnCall.args.join(" ") !== "serve" || spawnCall.options.shell !== false || spawnCall.options.windowsHide !== true || spawnCall.options.env.OLLAMA_MODELS !== path.resolve(selectedDirectory) || spawnCall.options.env.OLLAMA_HOST !== "127.0.0.1:32123") throw new Error(`受管 Ollama 启动参数没有消费所选目录：${JSON.stringify(spawnCall.options)}`);
  const stored = JSON.parse(await readFile(configPath, "utf8"));
  if (stored.directory !== path.resolve(selectedDirectory)) throw new Error("用户选择目录没有持久化到设备配置");
  const pullProgress = [];
  const pulled = await runtime.pull("llama3.2:1b-instruct-q4_K_M", { onProgress: (event) => pullProgress.push(event) });
  if (!pulled.runtime.installedModels.includes("llama3.2:1b-instruct-q4_K_M") || !pullProgress.some((event) => event.completed === 2 && event.total === 2)) throw new Error("受管 Ollama 没有消费 /api/pull 进度并通过 /api/tags 验证模型");
  await runtime.activate(selectedDirectory);
  if (spawns.length !== 1) throw new Error("同一目录重复启动了第二个 Ollama 进程");
  await runtime.stop();
  if (spawnCall.child.exitCode === null) throw new Error("App 退出时受管 Ollama 没有停止");

  const restoredRuntime = new ManagedOllamaRuntime({ configPath, ...dependencies });
  const restored = await restoredRuntime.restore();
  if (restored?.directory !== path.resolve(selectedDirectory) || spawns.length !== 2) throw new Error("重启后没有从当前设备配置恢复所选模型目录");
  await restoredRuntime.stop();

  const missingExecutable = new ManagedOllamaRuntime({ configPath: path.join(temporary, "missing.json"), ...dependencies, executableResolver: () => "" });
  await missingExecutable.activate(path.join(temporary, "missing-runtime")).then(() => { throw new Error("没有 Ollama CLI 时伪造了受管运行时成功"); }, (error) => {
    if (!String(error.message).includes("未找到 Ollama CLI")) throw error;
  });

  const masRuntime = new ManagedOllamaRuntime({ configPath: path.join(temporary, "mas.json"), isMas: true, ...dependencies });
  await masRuntime.activate(path.join(temporary, "custom-mas-models")).then(() => { throw new Error("Mac App Store 沙箱错误启动了自定义外部运行时"); }, (error) => {
    if (!String(error.message).includes("Mac App Store")) throw error;
  });
  const masDefault = await masRuntime.activate(defaultOllamaModelsPath());
  if (masDefault.managed !== false) throw new Error("Mac App Store 默认外部 Ollama 路径被错误标成受管进程");

  console.log(JSON.stringify({ selectedDirectoryConsumed: true, loopbackOnly: true, shellDisabled: true, apiPullConsumed: true, tagsVerified: true, configRestored: true, duplicateSpawnBlocked: true, missingRuntimeBlocked: true, masCustomRuntimeBlocked: true }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
