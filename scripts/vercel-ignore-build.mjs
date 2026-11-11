import { spawnSync } from "node:child_process";

// Compare with the last successful deployment, so a failed code build followed
// by a docs commit still builds. Missing/shallow history must also build.
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA ?? "";
if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(previousSha)) {
  console.log("Building: no valid previous deployment SHA.");
  process.exit(1);
}

const diff = spawnSync("git", [
  "diff", "--no-renames", "--name-only", "-z", previousSha, "HEAD", "--",
], { encoding: "utf8", timeout: 10_000 });

if (diff.status !== 0) {
  console.log("Building: unable to compare deployment history.");
  process.exit(1);
}

const paths = diff.stdout.split("\0").filter(Boolean);
const docsOnly = paths.length > 0 && paths.every((path) =>
  /^(?:README|AGENTS|CLAUDE)\.md$/.test(path) ||
  (path.startsWith("docs/") && path.endsWith(".md")),
);

console.log(docsOnly ? "Skipping documentation-only build." : "Building: application changes or explicit rebuild.");
process.exit(docsOnly ? 0 : 1);
