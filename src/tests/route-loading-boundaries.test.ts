import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// These folders each contain only a single static child route.
const deferred = new Set(["(internal)/accounts/client", "(internal)/accounts/member"]);

function pageFolders(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pageFolders(join(root, entry.name));
    return /^page\.[jt]sx?$/.test(entry.name) ? [root] : [];
  });
}

describe("nested route loading coverage", () => {
  it.each(["(internal)", "account"])("covers every parent of a nested page in %s", (surface) => {
    const app = resolve(import.meta.dirname, "../app");
    const root = join(app, surface);
    const parents = new Set<string>();
    for (const folder of pageFolders(root)) {
      let parent = resolve(folder, "..");
      while (parent.startsWith(root)) {
        parents.add(parent);
        if (parent === root) break;
        parent = resolve(parent, "..");
      }
    }
    const missing = [...parents].filter((folder) => !deferred.has(relative(app, folder).replaceAll("\\", "/")) && !existsSync(join(folder, "loading.tsx")));
    expect(missing.map((folder) => relative(app, folder))).toEqual([]);
  });
});
