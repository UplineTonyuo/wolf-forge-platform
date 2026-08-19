import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const requestedAgent = process.argv[2] || "unknown";
const agent = requestedAgent.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30) || "unknown";

function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function findRepoRoot() {
  const cwd = process.cwd();
  const root = runGit(["rev-parse", "--show-toplevel"], cwd);
  return root || cwd;
}

const repoRoot = findRepoRoot();
const memoryDir = path.join(repoRoot, ".ai-memory");
const rawDir = path.join(memoryDir, "Raw");

if (!fs.existsSync(memoryDir)) {
  process.exit(0);
}

fs.mkdirSync(rawDir, { recursive: true });

const now = new Date();
const iso = now.toISOString();
const fileStamp = iso.replace(/[:.]/g, "-");

const branch = runGit(["branch", "--show-current"], repoRoot) || "(unknown)";
const latestCommit =
  runGit(["log", "-1", "--pretty=format:%h %s"], repoRoot) || "(unavailable)";
const status = runGit(["status", "--short"], repoRoot) || "(clean)";
const changedFiles =
  runGit(["diff", "HEAD", "--name-only"], repoRoot) || "(none)";
const diffStat =
  runGit(["diff", "HEAD", "--stat"], repoRoot) || "(none)";

function mtime(relativePath) {
  try {
    return fs.statSync(path.join(memoryDir, relativePath)).mtime.toISOString();
  } catch {
    return "(unavailable)";
  }
}

const body = `# Agent Stop Snapshot

- Agent: ${agent}
- Captured: ${iso}
- Branch: ${branch}
- Latest commit: ${latestCommit}
- Current State last modified: ${mtime("01 Current State.md")}
- Implementation Log last modified: ${mtime("03 Implementation Log.md")}

## Working tree

\`\`\`text
${status}
\`\`\`

## Changed filenames

\`\`\`text
${changedFiles}
\`\`\`

## Diff statistics

\`\`\`text
${diffStat}
\`\`\`

## Safety

This automatic fallback intentionally stores metadata only.
It does not capture source-code diffs, environment variables, credentials,
terminal transcripts, or model reasoning.

Semantic project memory belongs in Current State, Decisions,
Implementation Log, Known Issues, and Architecture Map.
`;

const snapshotPath = path.join(
  rawDir,
  `${fileStamp}-${agent}-stop.md`,
);

fs.writeFileSync(snapshotPath, body, "utf8");
fs.writeFileSync(
  path.join(rawDir, "_latest-stop.md"),
  body,
  "utf8",
);

console.log(`Shared-memory fallback snapshot saved: ${snapshotPath}`);