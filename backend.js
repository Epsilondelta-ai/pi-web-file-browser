import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";

const method = process.argv[2] || "";
const root = process.argv[3] || "";
const input = await readInput();

try {
  if (!root) throw new Error("workspace root is required");
  if (method === "list") respond({ files: listFiles(root), statusMap: gitStatus(root) });
  else if (method === "create") respond({ file: createFile(root, input.path || "", input.content || "") });
  else if (method === "read") respond(readFile(root, input.path || ""));
  else if (method === "write") respond(writeFile(root, input.path || "", input.content || ""));
  else throw new Error(`unknown method: ${method}`);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function respond(value) {
  process.stdout.write(JSON.stringify(value));
}

function listFiles(rootPath) {
  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith(".git"))
    .sort(compareEntries)
    .map((entry) => nodeFor(rootPath, entry.name));
}

function nodeFor(rootPath, relPath) {
  const absPath = join(rootPath, relPath);
  const stats = statSync(absPath);
  const name = relPath.split(sep).pop() || relPath;
  if (!stats.isDirectory()) return { type: "file", name, path: slash(relPath) };
  return {
    type: "dir",
    name,
    path: slash(relPath),
    children: readdirSync(absPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".git"))
      .sort(compareEntries)
      .map((entry) => nodeFor(rootPath, join(relPath, entry.name))),
  };
}

function compareEntries(left, right) {
  if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
  return left.name.localeCompare(right.name);
}

function createFile(rootPath, relPath, content) {
  const cleanPath = cleanRel(relPath);
  const absPath = join(rootPath, cleanPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, { flag: "wx" });
  return { path: slash(cleanPath) };
}

function cleanRel(relPath) {
  const clean = String(relPath).replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("invalid file path");
  return clean;
}

function readFile(rootPath, relPath) {
  const cleanPath = cleanRel(relPath);
  const absPath = join(rootPath, cleanPath);
  const stats = statSync(absPath);
  if (stats.isDirectory()) throw new Error("cannot open directory");
  const data = readFileSync(absPath);
  return {
    path: slash(cleanPath),
    content: data.toString("utf8"),
    size: data.length,
    mime: mimeType(cleanPath),
  };
}

function writeFile(rootPath, relPath, content) {
  const cleanPath = cleanRel(relPath);
  writeFileSync(join(rootPath, cleanPath), String(content));
  return readFile(rootPath, cleanPath);
}

function mimeType(path) {
  const ext = path.toLowerCase().split(".").pop() || "";
  return {
    css: "text/css",
    go: "text/x-go",
    html: "text/html",
    js: "text/javascript",
    json: "application/json",
    jsx: "text/javascript",
    md: "text/markdown",
    ts: "text/typescript",
    tsx: "text/typescript",
    txt: "text/plain",
    yaml: "application/yaml",
    yml: "application/yaml",
  }[ext] || "text/plain";
}

function gitStatus(rootPath) {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-z"], { cwd: rootPath, encoding: "utf8" });
    const result = {};
    for (const item of output.split("\0").filter(Boolean)) {
      const code = item.slice(0, 2);
      const path = item.slice(3);
      result[slash(path)] = statusName(code);
    }
    return result;
  } catch {
    return {};
  }
}

function statusName(code) {
  if (code.includes("?")) return "untracked";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  return "modified";
}

function slash(value) {
  return relative(".", value).split(sep).join("/");
}
