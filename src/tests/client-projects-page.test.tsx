import { setImmediate } from "node:timers/promises";
import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "../lib/errors/application-error";
const mocks = vi.hoisted(() => ({ context: vi.fn(), projects: vi.fn(), replies: vi.fn(), assignments: vi.fn(), module: vi.fn(), redirect: vi.fn(), visibility: vi.fn() }));
const access = { portal_projects: true, portal_forms: true };
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => { mocks.redirect(...args); throw new Error("redirect"); } }));
vi.mock("../lib/supabase/client-portal-data", () => ({ readClientProjects: mocks.projects, readClientAssignments: mocks.assignments }));
vi.mock("../app/actions/forms-visibility", () => ({ loadFormsVisibility: mocks.visibility }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: mocks.context }));
const { default: page } = await import("../app/account/projects/page");
beforeEach(() => { vi.resetAllMocks(); access.portal_projects = true; access.portal_forms = true; mocks.context.mockResolvedValue({ user: { modules: access }, services: { projects: {listClientResponseStates:mocks.replies}, permissions: { requireModuleAccess: mocks.module } } }); mocks.projects.mockResolvedValue([{ id: "project" }]); mocks.replies.mockResolvedValue([{order_id:"project",unanswered:false}]); mocks.assignments.mockResolvedValue([]); mocks.visibility.mockResolvedValue({ ok: true, signature: "current-scope" }); });
it("loads reply metadata only for the authorized order IDs", async () => {
  mocks.replies.mockResolvedValue([{order_id:"project",unanswered:true}]);
  const result=await page();
  expect(mocks.replies).toHaveBeenCalledExactlyOnceWith(["project"]);
  expect(result.props.responseStates).toEqual([{order_id:"project",unanswered:true}]);
  expect(result.props.replyError).toBeNull();
});
it("preserves orders and intake when reply metadata fails or is unknown", async () => {
  mocks.replies.mockRejectedValue(new PermissionDeniedError());
  let result=await page();
  expect(result.props.projects).toHaveLength(1);
  expect(result.props.replyError).toMatch(/could not be loaded/);
  expect(mocks.redirect).not.toHaveBeenCalled();
  mocks.replies.mockResolvedValue([{order_id:"project",unanswered:null}]);
  result=await page();
  expect(result.props.replyError).toMatch(/unavailable/);
});
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
  expect(mocks.replies).not.toHaveBeenCalled();
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

it("starts independently authorized Forms while Orders is still pending", async () => {
  let finish!: (value: unknown[]) => void;
  mocks.projects.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = page();
  try {
    await setImmediate();
    expect(mocks.module).toHaveBeenCalledWith("portal_forms");
    expect(mocks.assignments).toHaveBeenCalledTimes(1);
    expect(mocks.replies).not.toHaveBeenCalled();
  } finally {
    finish([{ id: "project" }]);
    await pending;
  }
});

it("keeps Orders/reply reads independent of a slow Forms grant", async () => {
  let finish!: () => void;
  mocks.module.mockImplementation((module: string) => module === "portal_forms"
    ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
  const pending = page();
  try {
    await setImmediate();
    expect(mocks.replies).toHaveBeenCalledExactlyOnceWith(["project"]);
    expect(mocks.visibility).not.toHaveBeenCalled();
    expect(mocks.assignments).not.toHaveBeenCalled();
  } finally {
    finish();
    await pending;
  }
});

it("preserves authorized Forms when Orders fails", async () => {
  mocks.projects.mockRejectedValue(new Error("Synthetic failure"));
  const result = await page();
  expect(result.props.formsContent).toBeTruthy();
  expect(result.props.loadError).toBeTruthy();
  expect(mocks.replies).not.toHaveBeenCalled();
  expect(mocks.assignments).toHaveBeenCalledTimes(1);
});

it("starts neither branch before the verified client context is ready", async () => {
  const context = await mocks.context();
  let finish!: (value: unknown) => void;
  mocks.context.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = page();
  try {
    await setImmediate();
    expect(mocks.module).not.toHaveBeenCalled();
    expect(mocks.projects).not.toHaveBeenCalled();
    expect(mocks.visibility).not.toHaveBeenCalled();
  } finally {
    finish(context);
    await pending;
  }
});

it("keeps overlapping request results separate when another company completes first", async () => {
  const context = await mocks.context();
  mocks.context.mockResolvedValueOnce({ ...context, user: { ...context.user, id: "actor-a", companyId: "company-a" } })
    .mockResolvedValueOnce({ ...context, user: { ...context.user, id: "actor-b", companyId: "company-b" } });
  let finish!: (value: unknown[]) => void;
  mocks.projects.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce([{ id: "company-b-order" }]);
  mocks.visibility.mockResolvedValueOnce({ ok: true, signature: "company-a" }).mockResolvedValueOnce({ ok: true, signature: "company-b" });
  const first = page();
  await setImmediate();
  const second = await page();
  expect(second.props.projects).toEqual([{ id: "company-b-order" }]);
  expect(second.props.formsContent.props.signature).toBe("company-b");
  finish([{ id: "company-a-order" }]);
  const result = await first;
  expect(result.props.projects).toEqual([{ id: "company-a-order" }]);
  expect(result.props.formsContent.props.signature).toBe("company-a");
  expect(mocks.projects).toHaveBeenCalledTimes(2);
  expect(mocks.assignments).toHaveBeenCalledTimes(2);
});
