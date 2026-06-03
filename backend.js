import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = dirname(fileURLToPath(import.meta.url));
const source = join(dir, "backend.go");
const binary = join(dir, ".pi-web-backend-bin");

if (needsBuild()) {
  const build = spawnSync("go", ["build", "-o", binary, source], { encoding: "utf8" });
  if (build.status !== 0) {
    process.stderr.write(build.stderr || build.stdout || "go build failed");
    process.exit(build.status || 1);
  }
}

const run = spawnSync(binary, process.argv.slice(2), {
  encoding: "utf8",
  input: await readStdin(),
  maxBuffer: 1024 * 1024 * 32,
});

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
process.exit(run.status || 0);

function needsBuild() {
  if (!existsSync(binary)) return true;
  return statSync(binary).mtimeMs < statSync(source).mtimeMs;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
