import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

const CONTENT_FILES = [
  "domain/operations/content-workflow.ts",
  "lib/integrations/content-workflow-source.ts",
  "services/content-workflow-service.ts",
  "components/operations/content-workflow-view.tsx",
  "app/(internal)/todo/departments/content/page.tsx",
];

describe("Content workflow storage boundaries", () => {
  for (const file of CONTENT_FILES) {
    it(`${file} stays outside Team Tasks and Order Tasks`, () => {
      const source = read(file);
      expect(source).not.toMatch(/\.from\(\s*["'](?:team_tasks|order_tasks)["']\s*\)/);
    });
  }

  it("keeps Content records independent of the Podcast domain type", () => {
    expect(read("domain/operations/content-workflow.ts")).not.toContain("PodcastOperationItem");
    expect(read("components/operations/content-workflow-view.tsx")).not.toContain("podcast-workflow");
  });
});

describe("shared Operations Google Sheets reader", () => {
  const source = read("lib/integrations/operations-google-sheets.ts");

  it("uses only the read-only Sheets scope and contains no write endpoints", () => {
    expect(source).toContain("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(source).not.toContain('"https://www.googleapis.com/auth/spreadsheets"');
    expect(source).not.toMatch(/:batchUpdate|:append|method:\s*["'](?:PUT|PATCH|DELETE)["']/);
  });
});
