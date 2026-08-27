import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRememberedLoginStore } from "../electron/login-credentials.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "ai-tip-login-credentials-"));
const filePath = path.join(root, "remembered-login.json");
const marker = "encrypted:";
const codec = {
  available: () => true,
  protect: (value) => Buffer.from(`${marker}${value}`, "utf8").toString("base64"),
  unprotect: (value) => {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.startsWith(marker)) throw new Error("invalid ciphertext");
    return decoded.slice(marker.length);
  }
};

async function expectReject(action, pattern) {
  try { await action(); }
  catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  throw new Error(`Expected rejection matching ${pattern}`);
}

try {
  const store = createRememberedLoginStore({ filePath, codec });
  await store.save({ email: "Reader@Example.COM ", password: "a-password-that-must-never-be-plaintext" });
  const disk = await readFile(filePath, "utf8");
  if (disk.includes("reader@example.com") || disk.includes("a-password-that-must-never-be-plaintext") || disk.includes("Reader@Example.COM")) {
    throw new Error("登录邮箱或密码以明文写入磁盘");
  }
  const loaded = await store.load();
  if (loaded.email !== "reader@example.com" || loaded.password !== "a-password-that-must-never-be-plaintext") throw new Error("安全登录凭据没有正确往返");

  await store.clear();
  if (await store.load() !== null) throw new Error("清除已保存账号后仍返回凭据");

  const unavailable = createRememberedLoginStore({ filePath, codec: { ...codec, available: () => false } });
  await expectReject(() => unavailable.save({ email: "reader@example.com", password: "secret123" }), /安全存储|secure storage/i);
  if (await unavailable.load() !== null) throw new Error("安全存储不可用时错误返回了凭据");

  await store.save({ email: "reader@example.com", password: "secret123" });
  const corrupt = createRememberedLoginStore({ filePath, codec: { ...codec, unprotect: () => { throw new Error("corrupt"); } } });
  if (await corrupt.load() !== null) throw new Error("损坏密文没有安全地失效");

  console.log(JSON.stringify({ encryptedAtRest: true, roundTrip: true, clear: true, noPlaintextFallback: true, corruptCiphertextRejected: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
