import { spawnSync } from "node:child_process";

let stdin = "";
process.stdin.setEncoding("utf8");

for await (const chunk of process.stdin) {
  stdin += chunk;
}

const result = spawnSync(
  process.execPath,
  [".ai-tools/memory-stop.mjs", "codex"],
  {
    cwd: process.cwd(),
    input: stdin,
    encoding: "utf8",
  },
);

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status !== 0) {
  if (result.stdout) {
    process.stderr.write(result.stdout);
  }

  process.exit(result.status ?? 1);
}

/*
 * Codex Stop hooks have a strict JSON stdout contract.
 * memory-stop.mjs may emit human-readable or Claude-oriented output,
 * so none of its stdout is forwarded.
 *
 * The memory snapshot has already completed successfully at this point.
 */
process.stdout.write(JSON.stringify({ continue: true }));