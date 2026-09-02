import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

function signatureStatus(file) {
  if (process.platform !== "win32") return { status: "NotChecked", reason: "Authenticode check requires Windows" };
  const script = `(Get-AuthenticodeSignature -LiteralPath '${file.replaceAll("'", "''")}').Status.ToString()`;
  const status = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
  return { status, signed: status === "Valid" };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  version,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sourceDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
  installer: { ...(await artifact(installer)), signature: signatureStatus(installer) },
  executable: { ...(await artifact(appExe)), signature: signatureStatus(appExe) },
  appAsar: await artifact(asar),
  thirdPartyNotices: await artifact(notices)
};
await writeFile(path.join(root, "release", "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest));

if (process.argv.includes("--require-signature") && (!manifest.installer.signature.signed || !manifest.executable.signature.signed)) {
  throw new Error("Windows candidate is not Authenticode-signed");
}
