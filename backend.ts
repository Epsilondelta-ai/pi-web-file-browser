import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const MAX_INLINE_CONTENT_BYTES: number = 700 * 1024;
const dir: string = dirname(fileURLToPath(import.meta.url));
const binary: string = resolveBinary();

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

const method: string = process.argv[2] || "";
const root: string = process.argv[3] || "";
const input: string = await readBackendInput();

if (method === "create-folder") {
  try {
    const data: BackendInput = parseBackendInput(input);
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
    const data: BackendInput = parseBackendInput(input);
    const file: WorkspaceFile = readWorkspaceFile(root, data.path);
    process.stdout.write(JSON.stringify(file));
    process.exit(0);
  } catch (error) {
    process.stderr.write(errorMessage(error, "failed to read file"));
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

type BackendInput = {
  path?: string;
};

type WorkspaceFile = {
  path: string;
  content: string;
  size: number;
  mime: string;
  truncated: boolean;
  readOnly: boolean;
};

function resolveBinary(): string {
  const os: string | undefined = { darwin: "darwin", linux: "linux" }[process.platform];
  const arch: string | undefined = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os || !arch) return join(dir, "bin", "unsupported", "pi-web-file-browser-backend");
  return join(dir, "bin", `${os}-${arch}`, "pi-web-file-browser-backend");
}

async function readBackendInput(): Promise<string> {
  const raw: string = await readStdin();
  return normalizeBackendInput(raw);
}

function parseBackendInput(input: string): BackendInput {
  const value: unknown = JSON.parse(input || "{}");

  if (!value || typeof value !== "object") {
    return {};
  }

  return value as BackendInput;
}

function readWorkspaceFile(root: string, rel: string | undefined): WorkspaceFile {
  const clean: string = normalizeRelPath(rel);
  const path: string = safeWorkspacePath(root, clean);
  const size: number = statSync(path).size;
  const truncated: boolean = size > MAX_INLINE_CONTENT_BYTES;
  const bytes: Buffer = readFileSync(path).subarray(0, truncated ? MAX_INLINE_CONTENT_BYTES : undefined);
  const suffix: string = truncated
    ? `\n\n--- File preview truncated at ${MAX_INLINE_CONTENT_BYTES} bytes. Save is disabled. ---\n`
    : "";
  return {
    path: clean,
    content: `${bytes.toString("utf8")}${suffix}`,
    size,
    mime: mimeType(clean),
    truncated,
    readOnly: truncated,
  };
}

function safeWorkspacePath(root: string, rel: string | undefined): string {
  if (!root) throw new Error("workspace root is required");
  const clean: string = normalizeRelPath(rel);
  return join(root, clean);
}

function mimeType(path: string): string {
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
    ".yml": "application/x-yaml",
  }[extname(path).toLowerCase()] || "text/plain";
}

function normalizeRelPath(rel: string | undefined): string {
  const clean: string = String(rel || "").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
  if (!clean || clean === "." || clean === ".." || clean.startsWith("../") || clean.includes("/../") || clean.endsWith("/..")) {
    throw new Error("invalid folder path");
  }
  return clean;
}

function normalizeBackendInput(raw: string): string {
  const trimmed: string = raw.trim();
  if (!trimmed) return raw;
  try {
    const input: unknown = JSON.parse(trimmed);
    if (isBackendEnvelope(input)) {
      return JSON.stringify(input.data);
    }
  } catch {
    // Keep the original payload. The Go backend will report malformed JSON.
  }
  return raw;
}

function isBackendEnvelope(input: unknown): input is { data: Record<string, unknown> } {
  if (!input || typeof input !== "object") {
    return false;
  }

  const data: unknown = (input as { data?: unknown }).data;
  return !!data && typeof data === "object";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
