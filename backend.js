import { existsSync } from "node:fs";
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

const run = spawnSync(binary, process.argv.slice(2), {
  encoding: "utf8",
  input: await readStdin(),
  maxBuffer: 1024 * 1024 * 32,
});

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
process.exit(run.status || 0);

function resolveBinary() {
  const os = { darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os || !arch) return join(dir, "bin", "unsupported", "pi-web-file-browser-backend");
  return join(dir, "bin", `${os}-${arch}`, "pi-web-file-browser-backend");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
