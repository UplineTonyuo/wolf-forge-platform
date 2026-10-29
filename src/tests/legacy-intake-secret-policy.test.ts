import { describe, expect, it, vi } from "vitest";
import type { AssignedFormDetail } from "../domain/forms/schema";
import { FormRepository } from "../repositories/form-repository";

const assignment = "b1770000-0000-4000-8000-000000000040";
const version = "b1770000-0000-4000-8000-000000000041";
const fieldKey = "b1770000-0000-4000-8000-000000000050";
const credential = "b1770000-0000-4000-8000-000000000060";
const legacy: AssignedFormDetail = {
  assignment: { assignment_id: assignment, form_type: "onboarding", form_version_id: version } as AssignedFormDetail["assignment"],
  schema: {
    form_id: "b1770000-0000-4000-8000-000000000042", form_type: "onboarding", canonical_key: "legacy-policy-177",
    form_version_id: version, version_number: 1, schema_hash: "34cd34d7725f6d2a33e1ab4703ea05eb", title: "Legacy intake",
    information_html: null, visibility: "assigned", type_config: {}, rules: [], fields: [{
      stable_field_key: fieldKey, sort_order: 0, field_type: "secret", label: "WordPress Password", placeholder: null,
      help_html: null, default_value: null, required: false, settings: { collection_mode: "disabled" },
      encrypted_collection_allowed: true, options: [], services: [],
    }],
  },
};

describe("legacy assigned intake collection policy", () => {
  it("retains the immutable schema while passing through the server collection flag", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: legacy, error: null });
    const repository = new FormRepository({ rpc } as unknown as ConstructorParameters<typeof FormRepository>[0]);
    const result = await repository.getAssignedForm(assignment);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_get_assigned_form_schema", { p_assignment_id: assignment });
    expect(result.schema).toBe(legacy.schema);
    expect(result.schema.fields[0]).toMatchObject({ encrypted_collection_allowed: true, settings: { collection_mode: "disabled" } });
    expect(result.schema.form_version_id).toBe(version);
    expect(result.schema.schema_hash).toBe(legacy.schema.schema_hash);
  });

  it("uses authoritative effective metadata and accepts only an opaque reference", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "app_get_form_assignment_history"
      ? { secret_fields: [{ field_key: fieldKey, collection_mode: "encrypted" }] } : { id: credential }, error: null }));
    const repository = new FormRepository({ rpc } as unknown as ConstructorParameters<typeof FormRepository>[0]);
    const input = { request_id: credential, form_version_id: version, context: { assignment_id: assignment }, files: [],
      values: [{ field_key: fieldKey, value: { credential_id: credential } }] };
    await expect(repository.submit(input)).resolves.toEqual({ id: credential });
    expect(rpc).toHaveBeenLastCalledWith("app_submit_form", expect.objectContaining({
      p_form_version_id: version, p_context: { assignment_id: assignment }, p_values: input.values,
    }));
    rpc.mockClear();
    await expect(repository.submit({ ...input, values: [{ field_key: fieldKey, value: "synthetic raw input" }] }))
      .rejects.toThrow("Passwords must be saved through encrypted collection.");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["app_get_form_assignment_history"]);
  });

  it("fails closed when current policy metadata is disabled or unavailable", async () => {
    for (const metadata of [{ secret_fields: [{ field_key: fieldKey, collection_mode: "disabled" }] }, {}]) {
      const rpc = vi.fn().mockResolvedValue({ data: metadata, error: null });
      const repository = new FormRepository({ rpc } as unknown as ConstructorParameters<typeof FormRepository>[0]);
      await expect(repository.submit({ request_id: credential, form_version_id: version, context: { assignment_id: assignment }, files: [],
        values: [{ field_key: fieldKey, value: { credential_id: credential } }] })).rejects.toThrow();
      expect(rpc.mock.calls.map(([name]) => name)).toEqual(["app_get_form_assignment_history"]);
    }
  });
});
