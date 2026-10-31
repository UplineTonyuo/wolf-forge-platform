import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "../lib/errors/application-error";
const mocks = vi.hoisted(() => ({ projects: vi.fn(), assignments: vi.fn(), module: vi.fn(), redirect: vi.fn(), visibility: vi.fn() }));
const access = { portal_projects: true, portal_forms: true };
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => { mocks.redirect(...args); throw new Error("redirect"); } }));
vi.mock("../lib/supabase/client-portal-data", () => ({ readClientProjects: mocks.projects, readClientAssignments: mocks.assignments }));
vi.mock("../app/actions/forms-visibility", () => ({ loadFormsVisibility: mocks.visibility }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: async () => ({ user: { modules: access }, services: { permissions: { requireModuleAccess: mocks.module } } }) }));
const { default: page } = await import("../app/account/projects/page");
beforeEach(() => { vi.resetAllMocks(); access.portal_projects = true; access.portal_forms = true; mocks.projects.mockResolvedValue([{ id: "project" }]); mocks.assignments.mockResolvedValue([]); mocks.visibility.mockResolvedValue({ ok: true, signature: "current-scope" }); });
it("keeps authorized projects available when Forms access is denied", async () => {
  mocks.assignments.mockRejectedValue(new PermissionDeniedError());
  const result = await page();
  expect(result.props.projects).toEqual([{ id: "project" }]);
  expect(result.props.intakeLinks).toEqual({});
  expect(result.props.intakeError).toMatch(/could not be loaded/);
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("retains standalone forms for Forms-only clients without reading orders", async () => {
  access.portal_projects = false;
  mocks.assignments.mockResolvedValue([]);
  const result = await page();
  expect(result.props.showProjects).toBe(false);
  expect(result.props.formsContent).toBeTruthy();
  expect(mocks.projects).not.toHaveBeenCalled();
  expect(mocks.module).not.toHaveBeenCalledWith("portal_projects");
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("does not read or expose forms for Orders-only clients", async () => {
  access.portal_forms = false;
  const result = await page();
  expect(result.props.projects).toHaveLength(1);
  expect(result.props.formsContent).toBeNull();
  expect(mocks.assignments).not.toHaveBeenCalled();
  expect(mocks.visibility).not.toHaveBeenCalled();
});
it("preserves live redaction on the embedded forms only", async () => {
  const result = await page();
  expect(result.props.formsContent.props.signature).toBe("current-scope");
  expect(result.props.formsContent.props.scope).toBe("client");
  expect(result.props.projects).toHaveLength(1);
});
it("fails closed on revoked form scope without hiding authorized orders", async () => {
  mocks.visibility.mockResolvedValue({ ok: false, denied: true });
  const result = await page();
  expect(result.props.projects).toHaveLength(1);
  expect(result.props.formsContent.props.role).toBe("alert");
  expect(result.props.intakeLinks).toEqual({});
  expect(mocks.assignments).not.toHaveBeenCalled();
});
it("routes clients with neither grant back to their account", async () => {
  access.portal_forms = false;
  access.portal_projects = false;
  await expect(page()).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith("/account");
  expect(mocks.projects).not.toHaveBeenCalled();
  expect(mocks.assignments).not.toHaveBeenCalled();
});
it("links only incomplete required enabled intakes and picks the first per order", async () => {
  const required = { order_id: "project", form_type: "intake", required: true, status: "assigned", assignment_id: "required" };
  mocks.assignments.mockResolvedValue([
    { ...required, required: false }, { ...required, status: "completed" }, { ...required, work_enabled: false },
    { ...required, form_type: "onboarding" }, required, { ...required, assignment_id: "second" },
  ]);
  expect((await page()).props.intakeLinks).toEqual({ project: "/account/onboarding/required" });
});
it("does not read either dataset after current server authorization denies both", async () => {
  mocks.module.mockRejectedValue(new PermissionDeniedError());
  await expect(page()).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith("/account");
  expect(mocks.assignments).not.toHaveBeenCalled();
});
