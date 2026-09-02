import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".");
const pnpmStore = path.join(root, "node_modules", ".pnpm");
const output = path.join(root, "THIRD-PARTY-NOTICES.txt");
const licensePattern = /^(licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const packages = new Map();

async function directories(folder) {
  return (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
}

async function addPackage(packageRoot) {
  const manifestPath = path.join(packageRoot, "package.json");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch { return; }
  if (!manifest.name || !manifest.version) return;
  const key = `${manifest.name}@${manifest.version}`;
  if (packages.has(key)) return;
  const licenseFiles = (await readdir(packageRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && licensePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const texts = [];
  for (const name of licenseFiles) {
    const value = (await readFile(path.join(packageRoot, name), "utf8").catch(() => ""))
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    if (value && !texts.includes(value)) texts.push(value);
  }
  packages.set(key, {
    name: manifest.name,
    version: manifest.version,
    declaredLicense: typeof manifest.license === "string" ? manifest.license : "See included license text",
    homepage: typeof manifest.homepage === "string" ? manifest.homepage : "",
    texts
  });
}

for (const storeEntry of await directories(pnpmStore)) {
  const modules = path.join(pnpmStore, storeEntry.name, "node_modules");
  for (const entry of await directories(modules)) {
    if (entry.name.startsWith("@")) {
      for (const scoped of await directories(path.join(modules, entry.name))) await addPackage(path.join(modules, entry.name, scoped.name));
    } else {
      await addPackage(path.join(modules, entry.name));
    }
  }
}

const runtimeLicenses = [
  ["llama.cpp / ggml", "runtime/llama.cpp/mac-x64/LICENSE"],
  ["LLVM OpenMP runtime shipped with llama.cpp for Windows", "runtime/llama.cpp/win-x64/LICENSE-LLVM-OpenMP"]
];
const sections = [
  "AI Tip — Third-Party Notices",
  "================================",
  "",
  "This file accompanies the distributed desktop application. It includes notices for installed JavaScript build/runtime packages and separately bundled native runtimes. Inclusion does not imply that every listed development package is present in the final binary; retaining additional notices is intentional.",
  ""
];

for (const item of [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
  sections.push("--------------------------------------------------------------------------------", `${item.name}@${item.version}`, `Declared license: ${item.declaredLicense}`);
  if (item.homepage) sections.push(`Project: ${item.homepage}`);
  if (item.texts.length) sections.push("", ...item.texts);
  else sections.push("", "No root license file was present in the installed package. Refer to the package metadata and upstream project for the applicable license text.");
  sections.push("");
}

for (const [label, relative] of runtimeLicenses) {
  const text = (await readFile(path.join(root, relative), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  sections.push("--------------------------------------------------------------------------------", label, `Source notice: ${relative}`, "", text, "");
}

const next = `${sections.join("\n").trimEnd()}\n`;
const current = await readFile(output, "utf8").catch(() => "");
if (current !== next) await writeFile(output, next, "utf8");
console.log(JSON.stringify({ packages: packages.size, output: path.relative(root, output), bytes: Buffer.byteLength(next) }));
