import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function normalizedCredentials(value) {
  const email = String(value?.email || "").trim().toLowerCase();
  const password = String(value?.password || "");
  if (!email || email.length > 320 || !email.includes("@")) throw new Error("登录邮箱无效");
  if (!password || password.length > 4096) throw new Error("登录密码无效");
  return { email, password };
}

export function createRememberedLoginStore({ filePath, codec }) {
  if (!path.isAbsolute(String(filePath || ""))) throw new Error("登录凭据存储路径必须是绝对路径");
  const available = () => Boolean(codec && typeof codec.available === "function" && codec.available());

  return Object.freeze({
    available,
    async load() {
      if (!available()) return null;
      try {
        const envelope = JSON.parse(await readFile(filePath, "utf8"));
        if (envelope?.version !== 1 || typeof envelope.ciphertext !== "string" || !envelope.ciphertext) return null;
        return normalizedCredentials(JSON.parse(codec.unprotect(envelope.ciphertext)));
      } catch {
        return null;
      }
    },
    async save(value) {
      if (!available()) throw new Error("系统安全存储不可用，无法安全保存登录密码；本次仍可正常登录。");
      const credentials = normalizedCredentials(value);
      const ciphertext = codec.protect(JSON.stringify(credentials));
      if (typeof ciphertext !== "string" || !ciphertext) throw new Error("系统安全存储没有返回有效密文");
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, ciphertext, updatedAt: new Date().toISOString() }), { encoding: "utf8", mode: 0o600 });
      await rm(filePath, { force: true });
      await rename(temporary, filePath);
      return { saved: true, email: credentials.email };
    },
    async clear() {
      await rm(filePath, { force: true });
      await rm(`${filePath}.tmp`, { force: true });
      return { cleared: true };
    }
  });
}
