import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function asFilePath(file) {
  return file instanceof URL ? fileURLToPath(file) : path.resolve(String(file));
}

function windowsPowerShellEnvironment() {
  const modulePaths = [
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, "Documents", "WindowsPowerShell", "Modules"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "WindowsPowerShell", "Modules"),
    process.env.SystemRoot && path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "WindowsPowerShell", "Modules")
  ].filter(Boolean);
  return { ...process.env, PSModulePath: modulePaths.join(path.delimiter) };
}

function shellCandidates() {
  const systemPowerShell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  return [
    { executable: "pwsh.exe", env: process.env },
    { executable: systemPowerShell, env: windowsPowerShellEnvironment() }
  ];
}

export function getWindowsAuthenticodeStatus(file) {
  if (process.platform !== "win32") {
    return { status: "NotChecked", signed: false, reason: "Authenticode check requires Windows" };
  }

  const filePath = asFilePath(file);
  const escapedPath = filePath.replaceAll("'", "''");
  const script = `$ErrorActionPreference = 'Stop'; Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; (Get-AuthenticodeSignature -LiteralPath '${escapedPath}').Status.ToString()`;
  const failures = [];

  for (const candidate of shellCandidates()) {
    try {
      const status = execFileSync(candidate.executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        env: candidate.env,
        windowsHide: true
      }).trim();
      if (!status) throw new Error("PowerShell returned an empty Authenticode status");
      return { status, signed: status === "Valid", checker: path.basename(candidate.executable) };
    } catch (error) {
      failures.push(`${candidate.executable}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to inspect Authenticode status for ${filePath}. ${failures.join(" | ")}`);
}
