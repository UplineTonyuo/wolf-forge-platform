import { beforeEach, expect, it, vi } from "vitest";
import { submitPublicFormAction } from "../app/actions/forms";
import type { SubmitFormInput } from "../domain/forms/schema";
import { toClientSafeError } from "../lib/errors/application-error";

const m = vi.hoisted(() => ({ check: vi.fn(), client: vi.fn(), submit: vi.fn(), observe: vi.fn() }));
vi.mock("botid/server", () => ({ checkBotId: m.check }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ createNextServerSupabaseClient: m.client, getClientContext: vi.fn(), getInternalContext: vi.fn() }));
vi.mock("../repositories/form-repository", () => ({ FormRepository: class { submit = m.submit; } }));
vi.mock("../lib/forms/intake-jobs", () => ({ runIntakeSubmissionJob: vi.fn() }));
vi.mock("../lib/security/observed-failure", () => ({ observeActionFailure: m.observe }));

const input: SubmitFormInput = {
  request_id: "aaaaaaaa-0000-4000-8000-000000000001",
  form_version_id: "aaaaaaaa-0000-4000-8000-000000000002",
  context: {}, values: [], files: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  m.check.mockResolvedValue({ isBot: false });
  m.client.mockResolvedValue({});
  m.submit.mockResolvedValue({ id: "saved" });
  m.observe.mockImplementation(async (error) => toClientSafeError(error));
});
it("verifies a human before creating a client or submitting the validated payload", async () => {
  expect(await submitPublicFormAction(input)).toEqual({ ok: true, data: { id: "saved" } });
  expect(m.submit).toHaveBeenCalledWith(input);
  expect(m.check.mock.invocationCallOrder[0]).toBeLessThan(m.client.mock.invocationCallOrder[0]!);
});
it.each(["bot", "provider error", "missing verdict"])("refuses %s before any database work with a generic error", async (kind) => {
  if (kind === "provider error") m.check.mockRejectedValue(new Error("private provider detail"));
  else m.check.mockResolvedValue(kind === "bot" ? { isBot: true } : {});
  const response = await submitPublicFormAction({ ...input, context: { bot_token: "untrusted-client-value" } });
  expect(response).toEqual({ ok: false, error: "You do not have permission to perform this operation." });
  expect(m.client).not.toHaveBeenCalled();
  expect(m.submit).not.toHaveBeenCalled();
  expect(m.observe).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: "form.submit_public" }));
});
it("still rejects malformed input before database access", async () => {
  expect((await submitPublicFormAction({ ...input, form_version_id: "invalid" })).ok).toBe(false);
  expect(m.client).not.toHaveBeenCalled();
  expect(m.submit).not.toHaveBeenCalled();
});
it("preserves an authoritative database refusal after a human verdict", async () => {
  m.submit.mockRejectedValue(new Error("database refusal"));
  expect(await submitPublicFormAction(input)).toEqual({ ok: false, error: "The operation failed." });
});
