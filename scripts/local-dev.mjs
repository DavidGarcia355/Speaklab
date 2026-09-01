import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const root = process.cwd();
const command = process.argv[2] || "status";
const port = 3000;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function assertProjectRoot() {
  if (!fs.existsSync(path.join(root, "package.json"))) {
    fail("Run this from the Habla app directory that contains package.json.");
  }
}

function readEnv() {
  const file = path.join(root, ".env.local");
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function powershell(script) {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function portProcess() {
  const output = powershell(
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`
  );
  if (!output) return null;
  const pid = Number(output);
  if (!Number.isFinite(pid)) return null;
  const commandLine = powershell(
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine`
  );
  return { pid, commandLine };
}

function isHablaNext(processInfo) {
  const commandLine = processInfo?.commandLine?.replaceAll("\\", "/").toLowerCase() ?? "";
  const projectRoot = path.resolve(root).replaceAll("\\", "/").toLowerCase();
  return commandLine.includes(projectRoot) && commandLine.includes("next");
}

function lanAddresses() {
  const items = [];
  for (const values of Object.values(os.networkInterfaces())) {
    for (const item of values || []) {
      if (item.family === "IPv4" && !item.internal) items.push(item.address);
    }
  }
  return items;
}

function lockStatus() {
  const lock = path.join(root, ".next", "dev", "lock");
  if (!fs.existsSync(lock)) return { exists: false, stale: false };
  const proc = portProcess();
  return { exists: true, stale: !isHablaNext(proc) };
}

function printUrls() {
  console.log(`Local:   http://localhost:${port}`);
  for (const address of lanAddresses()) console.log(`Network: http://${address}:${port}`);
}

function printState() {
  const env = readEnv();
  console.log(`AI grading: ${env.AI_GRADING_ENABLED === "true" ? "enabled" : "disabled"}`);
  console.log(`Transcription provider: ${env.AI_TRANSCRIPTION_PROVIDER || "openai"}`);
  console.log(`Grading provider: ${env.AI_GRADING_PROVIDER || "ollama"}`);
  console.log(`Auth bypass: ${env.LOCAL_DEV_BYPASS_AUTH === "true" ? "enabled" : "disabled"}`);
}

assertProjectRoot();

if (command === "status") {
  const proc = portProcess();
  if (proc) {
    console.log(`Port ${port}: in use by PID ${proc.pid}`);
    console.log(isHablaNext(proc) ? "Habla appears to be running." : "Another process is using the port.");
  } else {
    console.log(`Port ${port}: available`);
  }
  const lock = lockStatus();
  console.log(`Next lock: ${lock.exists ? (lock.stale ? "stale" : "active") : "absent"}`);
  printUrls();
  printState();
  process.exit(0);
}

if (command === "stop") {
  const proc = portProcess();
  if (!proc) {
    console.log("No process is listening on port 3000.");
    process.exit(0);
  }
  if (!isHablaNext(proc)) {
    fail(`Port 3000 is owned by PID ${proc.pid}, but it does not look like Habla. Stop it manually if intended.`);
  }
  powershell(`Stop-Process -Id ${proc.pid} -Force`);
  console.log(`Stopped Habla dev server PID ${proc.pid}.`);
  process.exit(0);
}

if (command !== "start") fail("Use start, status, or stop.");

const proc = portProcess();
if (isHablaNext(proc)) {
  console.log(`Habla is already running on port ${port} (PID ${proc.pid}).`);
  printUrls();
  printState();
  process.exit(0);
}
if (proc) {
  console.log(`Port ${port} is already used by PID ${proc.pid}.`);
  console.log(proc.commandLine || "(command line unavailable)");
  fail("Stop that process or run npm.cmd run dev:stop if it is Habla.");
}

const lock = lockStatus();
if (lock.stale) {
  fs.rmSync(path.join(root, ".next", "dev", "lock"), { force: true });
  console.log("Removed stale .next/dev/lock.");
} else if (lock.exists) {
  fail("A Next dev lock exists and appears active. Run npm.cmd run dev:status.");
}

printState();
printUrls();
console.log("Starting Habla on port 3000...");
const child = spawn("cmd.exe", ["/d", "/s", "/c", `npm.cmd run dev -- --hostname 0.0.0.0 --port ${port}`], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
child.on("exit", (code) => process.exit(code ?? 0));
