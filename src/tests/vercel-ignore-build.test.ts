import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve("scripts/vercel-ignore-build.mjs");
let repository: string;
let previousSha: string;

function git(...args: string[]) {
  return execFileSync("git", [
    "-c", "core.hooksPath=disabled-test-hooks",
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Build filter test",
    "-c", "user.email=build-filter@example.invalid",
    ...args,
  ], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), content);
  }
  git("add", "--all");
  git("commit", "--quiet", "-m", "fixture");
  return git("rev-parse", "HEAD");
}

function run(previous: string | undefined = previousSha) {
  const env = { ...process.env };
  if (previous === undefined) delete env.VERCEL_GIT_PREVIOUS_SHA;
  else env.VERCEL_GIT_PREVIOUS_SHA = previous;
  const result = spawnSync(process.execPath, [script], {
    cwd: repository, env, encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  return result;
}

beforeEach(() => {
  repository = mkdtempSync(join(tmpdir(), "wolf-forge-build-filter-"));
  git("init", "--quiet");
  previousSha = commit({ "README.md": "initial", "src/app.ts": "initial" });
});

afterEach(() => rmSync(repository, { recursive: true, force: true }));

describe("Vercel docs-only build filter", () => {
  it("skips a commit containing only root and nested Markdown documentation", () => {
    commit({ "README.md": "updated", "docs/setup/first steps.md": "guide", "AGENTS.md": "rules", "CLAUDE.md": "rules" });
    expect(run().status).toBe(0);
  });

  it.each(["src/app.ts", "package-lock.json", "next.config.ts", "vercel.json", "docs/config.json", "public/help.md", "scripts/deploy.md"])("builds when %s changes alongside documentation", (path) => {
    commit({ "README.md": "updated", [path]: "changed" });
    expect(run().status).toBe(1);
  });

  it("compares all changes since the last successful deployment, not just the parent commit", () => {
    commit({ "src/app.ts": "changed" });
    commit({ "README.md": "updated" });
    expect(run().status).toBe(1);
  });

  it("builds when application code is renamed into the documentation directory", () => {
    mkdirSync(join(repository, "docs"));
    git("mv", "src/app.ts", "docs/moved.md");
    git("commit", "--quiet", "-m", "rename fixture");
    expect(run().status).toBe(1);
  });

  it("skips deleted documentation", () => {
    git("rm", "README.md");
    git("commit", "--quiet", "-m", "delete fixture");
    expect(run().status).toBe(0);
  });

  it("keeps manual rebuilds with an unchanged tree", () => {
    expect(run().status).toBe(1);
  });

  it.each(["", "--help", "f".repeat(40)])("builds when the previous deployment SHA is missing, invalid or unavailable (%s)", (previous) => {
    commit({ "README.md": "updated" });
    expect(run(previous).status).toBe(1);
  });
});
