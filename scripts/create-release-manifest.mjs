import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getWindowsAuthenticodeStatus } from "./windows-authenticode.mjs";

const root = path.resolve(".");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const installer = path.join(root, "release", `AI Tip Setup ${version}.exe`);
const appExe = path.join(root, "release", "win-unpacked", "AI Tip.exe");
const asar = path.join(root, "release", "win-unpacked", "resources", "app.asar");
const notices = path.join(root, "release", "win-unpacked", "resources", "THIRD-PARTY-NOTICES.txt");

async function artifact(file) {
  const bytes = await readFile(file);
  const info = await stat(file);
  return { path: path.relative(root, file).replaceAll("\\", "/"), bytes: info.size, sha256: createHash("sha256").update(bytes).digest("hex"), modifiedAt: info.mtime.toISOString() };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  version,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sourceDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
  installer: { ...(await artifact(installer)), signature: getWindowsAuthenticodeStatus(installer) },
  executable: { ...(await artifact(appExe)), signature: getWindowsAuthenticodeStatus(appExe) },
  appAsar: await artifact(asar),
  thirdPartyNotices: await artifact(notices)
};
await writeFile(path.join(root, "release", "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest));

if (process.argv.includes("--require-signature") && (!manifest.installer.signature.signed || !manifest.executable.signature.signed)) {
  throw new Error("Windows candidate is not Authenticode-signed");
}
