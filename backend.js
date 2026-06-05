import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = dirname(fileURLToPath(import.meta.url));
const binary = resolveBinary();

if (!existsSync(binary)) {
  process.stderr.write(`Unsupported platform or missing backend binary: ${process.platform}/${process.arch}\n`);
  process.stderr.write(`Expected binary at: ${binary}\n`);
  process.exit(1);
}

try {
  chmodSync(binary, 0o755);
} catch {
  // The binary may already be executable or live on a read-only filesystem.
}

const method = process.argv[2] || "";
const root = process.argv[3] || "";
const input = await readBackendInput();

if (method === "create-folder") {
  try {
    const data = JSON.parse(input || "{}");
    mkdirSync(safeWorkspacePath(root, data.path), { recursive: true });
    process.stdout.write(JSON.stringify({ ok: true, path: normalizeRelPath(data.path) }));
    process.exit(0);
  } catch (error) {
    process.stderr.write(error.message || "failed to create folder");
    process.exit(1);
  }
}

const run = spawnSync(binary, process.argv.slice(2), {
  encoding: "utf8",
  input,
  maxBuffer: 1024 * 1024 * 32,
});

if (run.error) {
  process.stderr.write(`Failed to execute backend binary: ${run.error.message}\n`);
  process.exit(1);
}

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
process.exit(run.status ?? 1);

function resolveBinary() {
  const os = { darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os || !arch) return join(dir, "bin", "unsupported", "pi-web-file-browser-backend");
  return join(dir, "bin", `${os}-${arch}`, "pi-web-file-browser-backend");
}

async function readBackendInput() {
  const raw = await readStdin();
  return normalizeBackendInput(raw);
}

function safeWorkspacePath(root, rel) {
  if (!root) throw new Error("workspace root is required");
  const clean = normalizeRelPath(rel);
  return join(root, clean);
}

function normalizeRelPath(rel) {
  const clean = String(rel || "").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
  if (!clean || clean === "." || clean === ".." || clean.startsWith("../") || clean.includes("/../") || clean.endsWith("/..")) {
    throw new Error("invalid folder path");
  }
  return clean;
}

function normalizeBackendInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  try {
    const input = JSON.parse(trimmed);
    if (input && typeof input === "object" && input.data && typeof input.data === "object") {
      return JSON.stringify(input.data);
    }
  } catch {
    // Keep the original payload. The Go backend will report malformed JSON.
  }
  return raw;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
