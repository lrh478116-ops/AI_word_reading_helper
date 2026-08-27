import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const mainPath = path.resolve("electron/main.mjs");

const result = await new Promise((resolve, reject) => {
  const child = spawn(electronExecutable, [mainPath, "--live-reference-search-test"], {
    cwd: path.resolve("."),
    env: { ...process.env, AI_TIP_SUPABASE_ENABLED: "0" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error(`Electron 真实联网测试超时。stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`));
  }, 120_000);
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", (error) => { clearTimeout(timeout); reject(error); });
  child.once("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0) return reject(new Error(`Electron 真实联网测试退出码 ${code}。stdout=${stdout.slice(-3000)} stderr=${stderr.slice(-3000)}`));
    const records = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{")).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    const record = records.findLast((item) => item.ok && item.networkStack === "electron-chromium");
    if (!record || record.sourceCount < 1) return reject(new Error(`Electron 没有报告真实参考来源。stdout=${stdout.slice(-3000)} stderr=${stderr.slice(-3000)}`));
    resolve(record);
  });
});

console.log(JSON.stringify(result, null, 2));
