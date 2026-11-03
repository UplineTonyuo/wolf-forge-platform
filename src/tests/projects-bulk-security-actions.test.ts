import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "../lib/errors/application-error";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), module: vi.fn(), labels: vi.fn(), status: vi.fn(),
  assign: vi.fn(), archive: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
const actions = await import("../app/actions/orders");

const actor = { id: "20000000-0000-4000-8000-000000000001" };
const ids = (count: number) => Array.from({ length: count }, (_, index) =>
  `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const capabilities = { create: true, edit: true, assign: true, archive: true };
function context(projects = capabilities) {
  return { actor, user: { projects }, services: {
    permissions: { requireModuleAccess: mocks.module },
    orders: { listLabels: mocks.labels, changeStatus: mocks.status, assign: mocks.assign, archive: mocks.archive },
  } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(context());
  mocks.labels.mockResolvedValue([]);
});

describe("Project bulk request security boundary", () => {
  it("keeps per-project partial success and de-duplicates a legitimate batch", async () => {
    const [first, second] = ids(2);
    mocks.labels.mockResolvedValue([{ id: first, order_number: 41, title: "Authorized Project" }]);
    mocks.status.mockRejectedValueOnce(new PermissionDeniedError());
    const result = await actions.bulkChangeProjectStatusAction([first!, second!, second!], "working");
    expect(result.attempted).toBe(2);
    expect(result.failed).toEqual([{ id: first, label: "#41 Authorized Project", error: expect.stringMatching(/permission/i) }]);
    expect(result.succeeded).toEqual([{ id: second, label: "Unavailable project" }]);
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(mocks.status).toHaveBeenLastCalledWith(second, { status: "working" }, actor);
  });

  it("allows the 50-project request boundary", async () => {
    const result = await actions.bulkChangeProjectStatusAction(ids(50), "working");
    expect(result.succeeded).toHaveLength(50);
    expect(mocks.status).toHaveBeenCalledTimes(50);
  });

  it.each([51, 1000])("rejects %i UUIDs before labels or operations, even when every operation would deny", async (count) => {
    mocks.status.mockRejectedValue(new PermissionDeniedError());
    const result = await actions.bulkChangeProjectStatusAction(ids(count), "working");
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("applies the raw input bound before de-duplicating repeated IDs", async () => {
    const result = await actions.bulkArchiveProjectsAction(Array(1000).fill(ids(1)[0]!));
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
  });

  it.each([
    ["invalid UUID", [ids(1)[0], "not-a-project-id"]],
    ["non-string ID", [ids(1)[0], 123]],
    ["null", null],
    ["object", { 0: ids(1)[0] }],
    ["string", ids(1)[0]],
  ])("refuses a malformed %s batch before labels or operations", async (_name, input) => {
    const result = await actions.bulkChangeProjectStatusAction(input as string[], "working");
    expect(result.succeeded).toEqual([]);
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["status", "assign", "archive"] as const)("refuses view-only %s requests before labels or mutation", async (kind) => {
    mocks.context.mockResolvedValue(context({ create: false, edit: false, assign: false, archive: false }));
    const result = kind === "status"
      ? await actions.bulkChangeProjectStatusAction(ids(2), "working")
      : kind === "assign"
        ? await actions.bulkAssignProjectsAction(ids(2), null)
        : await actions.bulkArchiveProjectsAction(ids(2));
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]?.error).toMatch(/permission/i);
    expect(mocks.labels).not.toHaveBeenCalled();
    for (const mutation of [mocks.status, mocks.assign, mocks.archive]) expect(mutation).not.toHaveBeenCalled();
  });

  it("preserves independent Project assignment and archive capabilities without requiring edit", async () => {
    mocks.context.mockResolvedValue(context({ create: false, edit: false, assign: true, archive: true }));
    expect((await actions.bulkAssignProjectsAction(ids(1), null)).succeeded).toHaveLength(1);
    expect((await actions.bulkArchiveProjectsAction(ids(1))).succeeded).toHaveLength(1);
  });

  it("rejects an invalid assignee before label lookup or mutation", async () => {
    const result = await actions.bulkAssignProjectsAction(ids(1), "invalid-assignee");
    expect(result.succeeded).toEqual([]);
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("keeps an empty selection a no-op", async () => {
    expect(await actions.bulkChangeProjectStatusAction([], "working")).toEqual({ attempted: 0, succeeded: [], failed: [] });
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
