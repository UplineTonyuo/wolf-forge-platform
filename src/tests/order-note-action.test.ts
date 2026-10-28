import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PermissionDeniedError } from "../lib/errors/application-error";
import { composeClientProjectViews } from "../domain/orders/client-projections";

const mocks = vi.hoisted(() => ({ context: vi.fn(), module: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
const { updateOrderNoteAction } = await import("../app/actions/orders");
const orderId = "20000000-0000-4000-8000-000000000001";
const actor = { id: "synthetic-actor" };
function context(edit = true) { return { actor, user: { projects: { edit } }, services: { permissions: { requireModuleAccess: mocks.module }, orders: { update: mocks.update } } }; }
beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue(context()); mocks.update.mockResolvedValue({ notes: "Saved note", title: "Must not be returned" }); });

describe("private notes-only action", () => {
  it("sends only a trimmed note through the existing scoped service and returns only the saved note", async () => {
    expect(await updateOrderNoteAction(orderId, "  Saved note  ")).toEqual({ ok: true, notes: "Saved note" });
    expect(mocks.module).toHaveBeenCalledWith("projects");
    expect(mocks.update).toHaveBeenCalledWith(orderId, { notes: "Saved note" }, actor);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${orderId}`);
  });
  it("clears with the existing null representation", async () => {
    mocks.update.mockResolvedValue({ notes: null });
    expect(await updateOrderNoteAction(orderId, "  \n ")).toEqual({ ok: true, notes: null });
    expect(mocks.update).toHaveBeenCalledWith(orderId, { notes: null }, actor);
  });
  it("refuses lost edit rights before mutation", async () => {
    mocks.context.mockResolvedValue(context(false));
    expect(await updateOrderNoteAction(orderId, "private draft")).toMatchObject({ ok: false, error: expect.stringMatching(/permission/i) });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses denied module or internal context reads before mutation", async () => {
    mocks.module.mockRejectedValue(new PermissionDeniedError());
    expect(await updateOrderNoteAction(orderId, "private draft")).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.context.mockRejectedValue(new PermissionDeniedError());
    expect(await updateOrderNoteAction(orderId, "private draft")).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("preserves database scope denial and does not echo draft content or revalidate", async () => {
    mocks.update.mockRejectedValue(new PermissionDeniedError());
    const result = await updateOrderNoteAction(orderId, "private draft");
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("private draft");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects a non-text payload without forwarding it", async () => {
    expect(await updateOrderNoteAction(orderId, { title: "attack" } as unknown as string)).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not add notes to client projections or content-bearing activity/notification paths", () => {
    const [project] = composeClientProjectViews([{ id: orderId, order_number: 1, title: "Synthetic order", status: "pending", created_at: "2026-10-28T10:00:00Z", due_at: null, started_at: null, completed_at: null, service_name: "Synthetic service", task_total: 0, task_open: 0, notes: "private draft" } as Parameters<typeof composeClientProjectViews>[0][number]]);
    expect(JSON.stringify(project)).not.toContain("private draft"); expect(project).not.toHaveProperty("notes");
    const sql = readFileSync("supabase/migrations/20261010130000_projects_module_enforcement.sql", "utf8");
    const update = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.app_update_order"), sql.indexOf("CREATE OR REPLACE FUNCTION public.app_assign_order"));
    expect(update).toContain("tenant_id = (select private.current_tenant_id())");
    expect(update).toContain("format('Updated project %s.', order_row.order_number)");
    expect(update).not.toContain("order_row.notes");
  });
});
