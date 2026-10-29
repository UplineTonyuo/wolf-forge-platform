import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "../lib/errors/application-error";
const mocks = vi.hoisted(() => ({ projects: vi.fn(), assignments: vi.fn(), module: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => { mocks.redirect(...args); throw new Error("redirect"); } }));
vi.mock("../lib/supabase/client-portal-data", () => ({ readClientProjects: mocks.projects, readClientAssignments: mocks.assignments }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: async () => ({ services: { permissions: { requireModuleAccess: mocks.module } } }) }));
const { default: page } = await import("../app/account/projects/page");
beforeEach(() => { vi.resetAllMocks(); mocks.projects.mockResolvedValue([{ id: "project" }]); mocks.assignments.mockResolvedValue([]); });
it("keeps authorized projects available when Forms access is denied", async () => {
  mocks.assignments.mockRejectedValue(new PermissionDeniedError());
  const result = await page();
  expect(result.props.projects).toEqual([{ id: "project" }]);
  expect(result.props.intakeLinks).toEqual({});
  expect(result.props.intakeError).toMatch(/could not be loaded/);
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("links only incomplete required enabled intakes and picks the first per order", async () => {
  const required = { order_id: "project", form_type: "intake", required: true, status: "assigned", assignment_id: "required" };
  mocks.assignments.mockResolvedValue([
    { ...required, required: false }, { ...required, status: "completed" }, { ...required, work_enabled: false },
    { ...required, form_type: "onboarding" }, required, { ...required, assignment_id: "second" },
  ]);
  expect((await page()).props.intakeLinks).toEqual({ project: "/account/onboarding/required" });
});
it("still refuses a denied Projects module before reading optional Forms", async () => {
  mocks.module.mockRejectedValue(new PermissionDeniedError());
  await expect(page()).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith("/account");
  expect(mocks.assignments).not.toHaveBeenCalled();
});
