import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KI-118 item 1 / D-275: the Onboarding Form pickers list the current Tenant's
// client memberships. The global profiles.role_id / company_id pair is Wolf
// Forge compatibility state and would offer the wrong people in another Tenant.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Onboarding assignment picker source", () => {
  it.each([
    "app/(internal)/forms/[formId]/assign/page.tsx",
    "app/(internal)/clients/[companyId]/page.tsx",
  ])("%s reads Tenant-relative onboarding candidates", (path) => {
    const code = source(path);
    expect(code).toContain("services.forms.listOnboardingCandidates(");
    expect(code).not.toMatch(/from\("profiles"\)\s*\.select\([^)]*\)\s*\.eq\("role_id"/u);
    expect(code).not.toMatch(/\.eq\("company_id"/u);
  });

  it("the repository calls the Tenant-bound RPC", () => {
    expect(source("repositories/form-repository.ts")).toContain('"app_list_onboarding_assignment_candidates"');
  });
});
