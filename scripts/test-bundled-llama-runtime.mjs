import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BundledLlamaRuntime } from "../electron/model-runtime.mjs";

const temporary = await mkdtemp(path.join(os.tmpdir(), "ai-tip-bundled-llama-"));
const helperPath = path.join(temporary, process.platform === "win32" ? "llama-server.exe" : "llama-server");
const modelDirectory = path.join(temporary, "models with spaces");
const modelPath = path.join(modelDirectory, "verified.gguf");
const configPath = path.join(temporary, "bundled-local-runtime.json");
const spawns = [];

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

try {
  await mkdir(modelDirectory, { recursive: true });
  await writeFile(helperPath, "signed-build-helper");
  await writeFile(modelPath, Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(128)]));
  const runtime = new BundledLlamaRuntime({
    configPath,
    helperPath,
    spawnRuntime: fakeSpawn,
    portAllocator: async () => 34123,
    fetchRuntime: async (url) => ({
      ok: url === "http://127.0.0.1:34123/v1/models",
      status: url.endsWith("/v1/models") ? 200 : 404,
      json: async () => ({ data: [{ id: "aitip:minicpm5-1b" }] })
    })
  });

  const prepared = runtime.prepareDirectory(modelDirectory);
  if (prepared.directory !== path.resolve(modelDirectory) || prepared.freeBytes <= 0 || prepared.runtime !== "llama.cpp") throw new Error(`目录准备没有使用内置运行时：${JSON.stringify(prepared)}`);
  if (spawns.length !== 0) throw new Error("选择下载目录时错误启动了外部运行时");

  const active = await runtime.activateModel(modelPath, "aitip:minicpm5-1b");
  if (!active.reachable || active.origin !== "http://127.0.0.1:34123" || active.modelId !== "aitip:minicpm5-1b" || active.modelPath !== path.resolve(modelPath)) throw new Error(`GGUF 没有成为正式运行时：${JSON.stringify(active)}`);
  const call = spawns[0];
  const expectedArgs = ["-m", path.resolve(modelPath), "--host", "127.0.0.1", "--port", "34123", "--alias", "aitip:minicpm5-1b", "--no-webui"];
  if (call.executable !== helperPath || call.options.shell !== false || call.options.windowsHide !== true || expectedArgs.some((value, index) => call.args[index] !== value)) throw new Error(`helper 没有消费模型路径/回环端口/模型别名：${JSON.stringify(call)}`);
  const stored = JSON.parse(await readFile(configPath, "utf8"));
  if (stored.modelPath !== path.resolve(modelPath) || stored.modelId !== "aitip:minicpm5-1b") throw new Error("已验证 GGUF lineage 没有持久化");

  await runtime.stop();
  if (call.child.exitCode === null) throw new Error("退出时没有停止内置 llama-server");

  const restored = new BundledLlamaRuntime({
    configPath,
    helperPath,
    spawnRuntime: fakeSpawn,
    portAllocator: async () => 34124,
    fetchRuntime: async (url) => ({ ok: url.endsWith("/v1/models"), status: 200, json: async () => ({ data: [{ id: "aitip:minicpm5-1b" }] }) })
  });
  const restoredInfo = await restored.restore();
  if (restoredInfo?.modelPath !== path.resolve(modelPath) || spawns.length !== 2) throw new Error("重启后没有加载同一 GGUF");
  await restored.stop();

  const missingHelper = new BundledLlamaRuntime({ configPath: path.join(temporary, "missing.json"), helperPath: path.join(temporary, "missing-helper") });
  await missingHelper.activateModel(modelPath, "aitip:test").then(() => { throw new Error("helper 缺失时伪造了成功"); }, (error) => {
    if (!String(error.message).includes("内置 llama.cpp")) throw error;
  });

  const fakeGguf = path.join(temporary, "fake.gguf");
  await writeFile(fakeGguf, "<html>mirror error</html>");
  await runtime.activateModel(fakeGguf, "aitip:fake").then(() => { throw new Error("HTML 冒充 GGUF 时仍启动了 helper"); }, (error) => {
    if (!String(error.message).includes("GGUF")) throw error;
  });

  console.log(JSON.stringify({ directoryDoesNotNeedOllama: true, bundledHelperConsumed: true, loopbackOnly: true, shellDisabled: true, ggufMagicRequired: true, restoreUsesSameModel: true, missingHelperBlocked: true }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
