// backend.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
var MAX_INLINE_CONTENT_BYTES = 700 * 1024;
var dir = dirname(fileURLToPath(import.meta.url));
var binary = resolveBinary();
if (!existsSync(binary)) {
  process.stderr.write(`Unsupported platform or missing backend binary: ${process.platform}/${process.arch}
`);
  process.stderr.write(`Expected binary at: ${binary}
`);
  process.exit(1);
}
try {
  chmodSync(binary, 493);
} catch {}
var method = process.argv[2] || "";
var root = process.argv[3] || "";
var input = await readBackendInput();
if (method === "create-folder") {
  try {
    const data = parseBackendInput(input);
    mkdirSync(safeWorkspacePath(root, data.path), { recursive: true });
    process.stdout.write(JSON.stringify({ ok: true, path: normalizeRelPath(data.path) }));
    process.exit(0);
  } catch (error) {
    process.stderr.write(errorMessage(error, "failed to create folder"));
    process.exit(1);
  }
}
if (method === "read") {
  try {
    const data = parseBackendInput(input);
    const file = readWorkspaceFile(root, data.path);
    process.stdout.write(JSON.stringify(file));
    process.exit(0);
  } catch (error) {
    process.stderr.write(errorMessage(error, "failed to read file"));
    process.exit(1);
  }
}
var run = spawnSync(binary, process.argv.slice(2), {
  encoding: "utf8",
  input,
  maxBuffer: 1024 * 1024 * 32
});
if (run.error) {
  process.stderr.write(`Failed to execute backend binary: ${run.error.message}
`);
  process.exit(1);
}
process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
process.exit(run.status ?? 1);
function resolveBinary() {
  const os = { darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os || !arch)
    return join(dir, "bin", "unsupported", "pi-web-file-browser-backend");
  return join(dir, "bin", `${os}-${arch}`, "pi-web-file-browser-backend");
}
async function readBackendInput() {
  const raw = await readStdin();
  return normalizeBackendInput(raw);
}
function parseBackendInput(input2) {
  const value = JSON.parse(input2 || "{}");
  if (!value || typeof value !== "object") {
    return {};
  }
  return value;
}
function readWorkspaceFile(root2, rel) {
  const clean = normalizeRelPath(rel);
  const path = safeWorkspacePath(root2, clean);
  const size = statSync(path).size;
  const truncated = size > MAX_INLINE_CONTENT_BYTES;
  const bytes = readFileSync(path).subarray(0, truncated ? MAX_INLINE_CONTENT_BYTES : undefined);
  const suffix = truncated ? `

--- File preview truncated at ${MAX_INLINE_CONTENT_BYTES} bytes. Save is disabled. ---
` : "";
  return {
    path: clean,
    content: `${bytes.toString("utf8")}${suffix}`,
    size,
    mime: mimeType(clean),
    truncated,
    readOnly: truncated
  };
}
function safeWorkspacePath(root2, rel) {
  if (!root2)
    throw new Error("workspace root is required");
  const clean = normalizeRelPath(rel);
  return join(root2, clean);
}
function mimeType(path) {
  return {
    ".css": "text/css",
    ".go": "text/x-go",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".jsx": "text/javascript",
    ".md": "text/markdown",
    ".sh": "text/x-shellscript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".txt": "text/plain",
    ".yaml": "application/x-yaml",
    ".yml": "application/x-yaml"
  }[extname(path).toLowerCase()] || "text/plain";
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
  if (!trimmed)
    return raw;
  try {
    const input2 = JSON.parse(trimmed);
    if (isBackendEnvelope(input2)) {
      return JSON.stringify(input2.data);
    }
  } catch {}
  return raw;
}
function isBackendEnvelope(input2) {
  if (!input2 || typeof input2 !== "object") {
    return false;
  }
  const data = input2.data;
  return !!data && typeof data === "object";
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}
