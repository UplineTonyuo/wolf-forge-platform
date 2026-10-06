import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Company / Team entities live in `organizations`; `companies` holds Client
// records whose name is the Client's business name. These guards keep the two
// from being conflated again on the server-rendered pages.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Company and Client separation", () => {
  it("labels the Client record's name as Business name on Client detail", () => {
    const page = source("app/(internal)/clients/[companyId]/page.tsx");
    expect(page).toMatch(/<BriefcaseBusiness aria-hidden="true" \/>\s*Business name\s*<\/dt>/u);
  });

  it.each([
    "app/(internal)/companies/page.tsx",
    "app/(internal)/companies/[companyId]/page.tsx",
    "app/actions/companies.ts",
  ])("%s reads and writes Company entities only, never Client records", (path) => {
    const code = source(path);
    expect(code).toContain("services.organizations.");
    expect(code).not.toMatch(/services\.companies\./u);
    expect(code).not.toMatch(/services\.contacts\.(create|listForCompan)/u);
  });
});
