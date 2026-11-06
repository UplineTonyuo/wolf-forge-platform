import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionDeniedError } from "../lib/errors/application-error";

const mocks = vi.hoisted(() => ({
  requireModuleAccess: vi.fn(),
  create: vi.fn(), update: vi.fn(), changeStatus: vi.fn(), assign: vi.fn(), archive: vi.fn(),
  listLabels: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({
    actor: { id: "20000000-0000-4000-8000-000000003603" },
    user: { projects: { create: true, edit: true, assign: true, archive: true } },
    services: {
      permissions: { requireModuleAccess: mocks.requireModuleAccess },
      orders: mocks,
    },
  }),
}));
const actions = await import("../app/actions/orders");
const { default: ProjectsLayout } = await import("../app/(internal)/orders/layout");
const id = "e7360000-0000-4000-8000-000000003601";
function form() {
  const values = new FormData();
  for (const [key, value] of Object.entries({ title: "Synthetic Project", company_id: id, service_id: id })) {
    values.set(key, value);
  }
  return values;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listLabels.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id });
});
describe("Projects mutation module boundary", () => {
  it.each(["create", "update"] as const)("refuses %s before calling a mutation", async (operation) => {
    mocks.requireModuleAccess.mockRejectedValue(new PermissionDeniedError());
    const state = operation === "create"
      ? await actions.createProjectAction({ error: null, fieldErrors: {} }, form())
      : await actions.updateProjectAction(id, { error: null, fieldErrors: {} }, form());
    expect(state.error).toMatch(/permission/i);
    expect(mocks.requireModuleAccess).toHaveBeenCalledWith("projects");
    expect(mocks[operation]).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each(["status", "assignment", "archive"] as const)("refuses bulk %s without looking up labels or mutating", async (operation) => {
    mocks.requireModuleAccess.mockRejectedValue(new PermissionDeniedError());
    const result = operation === "status"
      ? await actions.bulkChangeProjectStatusAction([id], "working")
      : operation === "assignment"
        ? await actions.bulkAssignProjectsAction([id], null)
        : await actions.bulkArchiveProjectsAction([id]);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(mocks.listLabels).not.toHaveBeenCalled();
    for (const mutation of [mocks.changeStatus, mocks.assign, mocks.archive]) expect(mutation).not.toHaveBeenCalled();
  });
  it("continues authorized bulk status changes after the module gate", async () => {
    const result = await actions.bulkChangeProjectStatusAction([id], "working");
    expect(result.succeeded).toHaveLength(1);
    expect(mocks.requireModuleAccess).toHaveBeenCalledWith("projects");
    expect(mocks.changeStatus).toHaveBeenCalledWith(id, { status: "working" }, expect.anything());
    expect(mocks.requireModuleAccess.mock.invocationCallOrder[0]).toBeLessThan(mocks.changeStatus.mock.invocationCallOrder[0]!);
  });
});

describe("internal Projects route boundary", () => {
  it("redirects denied Projects routes before returning their contents", async () => {
    mocks.requireModuleAccess.mockRejectedValue(new PermissionDeniedError());
    mocks.redirect.mockImplementation(() => { throw new Error("route redirect"); });
    await expect(ProjectsLayout({ children: "Project contents" })).rejects.toThrow("route redirect");
    expect(mocks.requireModuleAccess).toHaveBeenCalledWith("projects");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
  it("preserves authorized route contents", async () => {
    expect(renderToStaticMarkup(await ProjectsLayout({ children: "Project contents" }))).toBe("Project contents");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("fails closed on an unavailable module check", async () => {
    mocks.requireModuleAccess.mockRejectedValue(new Error("module check unavailable"));
    await expect(ProjectsLayout({ children: "Project contents" })).rejects.toThrow("module check unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
