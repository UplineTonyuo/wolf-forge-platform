import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFormSchema, intakeSecretCaptureSchema, intakeSecretReferenceSchema } from "../domain/forms/schema";
import { FormRepository } from "../repositories/form-repository";
import { captureIntakeSecret, listIntakeSecretReferences, revealIntakeSecret } from "../app/actions/intake-secrets";
import { saveIntakeDraft } from "../app/actions/intake-drafts";

const state = vi.hoisted(() => ({ client: vi.fn(), internal: vi.fn(), capture: vi.fn(), list: vi.fn(), reveal: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: state.client, getInternalContext: state.internal, getSelfServiceContext: vi.fn() }));
const key = "a0000000-0000-4000-8000-000000000001";
const assignment = "b0000000-0000-4000-8000-000000000001";
const credential = "c0000000-0000-4000-8000-000000000001";
const password = "synthetic-boundary-password";
const field = { stable_field_key: key, sort_order: 0, field_type: "secret", label: "WordPress password", required: true, settings: { collection_mode: "encrypted" } };
const payload = { request_id: assignment, form_type: "intake", canonical_key: "credential-boundary", definition: { name: "Credential", title: "Credential", visibility: "assigned", fields: [field] } };
beforeEach(() => {
  vi.clearAllMocks();
  state.capture.mockResolvedValue({ credential_id: credential });
  state.list.mockResolvedValue([{ credential_id: credential, field_key: key, label: "WordPress password" }]);
  state.reveal.mockResolvedValue(password);
  state.client.mockResolvedValue({ actor: {}, services: { forms: { captureIntakeSecret: state.capture } } });
  state.internal.mockResolvedValue({ actor: {}, services: { forms: { listIntakeSecretReferences: state.list, revealIntakeSecret: state.reveal } } });
});

describe("encrypted intake credential boundaries", () => {
  it("accepts required encrypted assigned intake/onboarding fields and rejects public/default passwords", () => {
    expect(createFormSchema.safeParse(payload).success).toBe(true);
    expect(createFormSchema.safeParse({ ...payload, form_type: "onboarding" }).success).toBe(true);
    expect(createFormSchema.safeParse({ ...payload, definition: { ...payload.definition, visibility: "public" } }).success).toBe(false);
    expect(createFormSchema.safeParse({ ...payload, definition: { ...payload.definition, fields: [{ ...field, default_value: password }] } }).success).toBe(false);
    expect(createFormSchema.safeParse({ ...payload, definition: { ...payload.definition, fields: [{ ...field, required: false, settings: { collection_mode: "disabled" } }] } }).success).toBe(true);
    expect(intakeSecretReferenceSchema.safeParse({ credential_id: credential, secret: password }).success).toBe(false);
  });

  it("preserves exact password bytes and enforces bounded dedicated capture input", () => {
    const input = { request_id: key, assignment_id: assignment, field_key: key, secret: "  exact password  " };
    expect(intakeSecretCaptureSchema.parse(input).secret).toBe(input.secret);
    expect(intakeSecretCaptureSchema.safeParse({ ...input, secret: "x".repeat(4097) }).success).toBe(false);
  });

  it("returns only the reference from capture and contains failures without echoing plaintext", async () => {
    const input = { request_id: key, assignment_id: assignment, field_key: key, secret: password };
    expect(await captureIntakeSecret(input)).toEqual({ ok: true, reference: { credential_id: credential } });
    state.capture.mockRejectedValue(new Error(password));
    const failed = await captureIntakeSecret(input);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(password);
    expect(state.internal).not.toHaveBeenCalled();
  });

  it("uses the internal boundary for explicit reference listing/reveal and contains denial detail", async () => {
    expect((await listIntakeSecretReferences(assignment)).ok).toBe(true);
    expect(await revealIntakeSecret(credential)).toEqual({ ok: true, secret: password });
    expect(state.client).not.toHaveBeenCalled();
    state.internal.mockRejectedValue(new Error(password));
    expect(await revealIntakeSecret(credential)).toEqual({ ok: false, error: "The password is unavailable under your current access." });
  });

  it("rejects raw passwords before the ordinary submission RPC while accepting only strict references", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "app_get_form_assignment_history" ? { secret_fields: [{ field_key: key, collection_mode: "encrypted" }] } : { id: credential }, error: null }));
    const repository = new FormRepository({ rpc } as unknown as ConstructorParameters<typeof FormRepository>[0]);
    const input = { request_id: key, form_version_id: credential, context: { assignment_id: assignment }, files: [] as never[], values: [{ field_key: key, value: password }] };
    await expect(repository.submit(input)).rejects.toThrow("Passwords must be saved through encrypted collection.");
    expect(rpc.mock.calls.some(([name]) => name === "app_submit_form")).toBe(false);
    await repository.submit({ ...input, values: [{ field_key: key, value: { credential_id: credential } }] });
    expect(rpc).toHaveBeenLastCalledWith("app_submit_form", expect.objectContaining({ p_values: [{ field_key: key, value: { credential_id: credential } }] }));
  });

  it("rejects raw passwords before the ordinary draft RPC", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "app_get_form_assignment_history" ? { secret_fields: [{ field_key: key, collection_mode: "encrypted" }] } : null, error: null }));
    state.client.mockResolvedValue({ client: { rpc } });
    expect((await saveIntakeDraft(assignment, [{ field_key: key, value: password }])).ok).toBe(false);
    expect(rpc.mock.calls.some(([name]) => name === "app_save_intake_draft")).toBe(false);
    expect((await saveIntakeDraft(assignment, [{ field_key: key, value: { credential_id: credential } }])).ok).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("app_save_intake_draft", { p_assignment_id: assignment, p_values: [{ field_key: key, value: { credential_id: credential } }] });
  });

  it("uses history-safe metadata before accepted submission replay instead of collection access", async () => {
    const rpc = vi.fn(async (name: string) => name === "app_get_assigned_form_schema"
      ? { data: null, error: { code: "42501", message: "WF_FORMS_DISABLED" } }
      : { data: name === "app_get_form_assignment_history" ? { status: "completed", secret_fields: [] } : { id: credential }, error: null });
    const repository = new FormRepository({ rpc } as unknown as ConstructorParameters<typeof FormRepository>[0]);
    await expect(repository.submit({ request_id: key, form_version_id: credential, context: { assignment_id: assignment }, values: [], files: [] })).resolves.toEqual({ id: credential });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["app_get_form_assignment_history", "app_submit_form"]);
  });
});
