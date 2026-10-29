import { describe, expect, it, vi } from "vitest";
import type { FormAssignmentSummary, FormPublishedSchema } from "../domain/forms/schema";
import { FormRepository } from "../repositories/form-repository";

function assignment(id: string, type: "intake" | "onboarding" = "intake"): FormAssignmentSummary {
  return { assignment_id: id, form_type: type, title: "Shared form", order_id: null } as FormAssignmentSummary;
}

function repository(rows: FormAssignmentSummary[]) {
  const rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(async (name, args) => {
    if (name === "app_list_assigned_forms") return { data: rows, error: null };
    if (name === "app_forms_work_enabled") return { data: true, error: null };
    if (name === "app_get_form_assignment_history") return { data: rows[0], error: null };
    if (name === "app_get_assigned_form_schema") return { data: { assignment: rows[0], schema: { title: "Immutable published form" } as FormPublishedSchema }, error: null };
    if (name === "app_get_assigned_form_service_labels") {
      return { data: (args!.p_assignment_ids as string[]).map((id) => ({ assignment_id: id, service_name: `Service ${id}` })), error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  return { rpc, forms: new FormRepository({ rpc } as unknown as ConstructorParameters<typeof FormRepository>[0]) };
}

describe("authorized assigned-service labels", () => {
  it("batches intake labels even when order pointers are redacted", async () => {
    const source = Array.from({ length: 101 }, (_, index) => assignment(`intake-${index}`));
    source.push(assignment("account", "onboarding"));
    const { forms, rpc } = repository(source);
    const rows = await forms.listAssignments();
    const batches = rpc.mock.calls.filter(([name]) => name === "app_get_assigned_form_service_labels");
    expect(batches.map(([, args]) => (args!.p_assignment_ids as string[]).length)).toEqual([100, 1]);
    expect(rows[0]).toMatchObject({ service_name: "Service intake-0", order_id: null, work_enabled: true });
    expect(rows[101]!.service_name).toBeNull();
    expect(source[0]!.service_name).toBeUndefined();
  });

  it("uses the same labels for history and fill pages while preserving the published schema", async () => {
    const { forms } = repository([assignment("one")]);
    expect(await forms.getAssignmentHistory("one")).toMatchObject({ service_name: "Service one", title: "Shared form" });
    const detail = await forms.getAssignedForm("one");
    expect(detail.assignment.service_name).toBe("Service one");
    expect(detail.schema.title).toBe("Immutable published form");
  });

  it("does not issue service reads for account-only assignments", async () => {
    const { forms, rpc } = repository([assignment("account", "onboarding")]);
    await forms.listAssignments();
    expect(rpc.mock.calls.some(([name]) => name === "app_get_assigned_form_service_labels")).toBe(false);
  });

  it("does not turn a failed authority read into a purchased-service title", async () => {
    const { forms, rpc } = repository([assignment("one")]);
    rpc.mockImplementation(async (name) => {
      if (name === "app_get_assigned_form_schema") return { data: { assignment: assignment("one"), schema: {} }, error: null };
      return { data: null, error: { code: "42501", message: "denied" } };
    });
    await expect(forms.getAssignedForm("one")).rejects.toThrow();
  });
});
