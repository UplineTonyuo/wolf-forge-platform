// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssignedFormPage from "../app/account/onboarding/[assignmentId]/page";
import { submitAssignedFormAction } from "../app/actions/forms";
import type { SubmitFormInput } from "../domain/forms/schema";
import { revalidatePath } from "next/cache";

const mocks = vi.hoisted(() => ({ history: vi.fn(), receipt: vi.fn(), work: vi.fn(), submit: vi.fn(), rpc: vi.fn(), detail: vi.fn(), redirect: vi.fn(), context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: () => { throw new Error("Not found"); } }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: mocks.context, getInternalContext: vi.fn(), createNextServerSupabaseClient: vi.fn() }));
vi.mock("../lib/forms/intake-jobs", () => ({ runIntakeSubmissionJob: vi.fn() }));
vi.mock("../components/forms/form-renderer", () => ({ FormRenderer: () => null }));
vi.mock("../components/forms/submission-detail", () => ({ SubmissionDetail: (props: unknown) => { mocks.detail(props); return null; } }));

const assignment = "10000000-0000-4000-8000-000000000001";
const submission = "20000000-0000-4000-8000-000000000001";
const input: SubmitFormInput = { request_id: "30000000-0000-4000-8000-000000000001", form_version_id: "40000000-0000-4000-8000-000000000001", context: { assignment_id: assignment }, values: [], files: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ actor: {}, services: { forms: { getAssignmentHistory: mocks.history, getSubmission: mocks.receipt, workEnabled: mocks.work, submit: mocks.submit } }, client: { rpc: mocks.rpc } });
  mocks.history.mockResolvedValue({ status: "completed", latest_submission_id: submission, title: "Synthetic form", order_id: null });
  mocks.receipt.mockResolvedValue({ submission: { id: submission } });
  mocks.work.mockResolvedValue(true);
  mocks.submit.mockResolvedValue({ id: submission });
  mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "app_get_intake_follow_up" ? "not_required" : null, error: null }));
  mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});
afterEach(cleanup);

describe("the authenticated submission receipt", () => {
  it("refreshes authoritative Project chat eligibility after a saved legacy intake without a start gate", async () => {
    const order = "50000000-0000-4000-8000-000000000001";
    mocks.submit.mockResolvedValue({ id: submission, order_id: order });
    await submitAssignedFormAction(input);
    expect(revalidatePath).toHaveBeenCalledWith(`/account/projects/${order}`);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each([undefined, "foreign-submission", [submission]])("does not automatically download for an absent or unmatched query %j", async (submitted) => {
    render(await AssignedFormPage({ params: Promise.resolve({ assignmentId: assignment }), searchParams: Promise.resolve({ submitted }) }));
    expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ automaticPdf: false, canCorrect: false }));
  });
  it("automatically downloads only the completed submission resolved through current authorization", async () => {
    render(await AssignedFormPage({ params: Promise.resolve({ assignmentId: assignment }), searchParams: Promise.resolve({ submitted: submission }) }));
    expect(mocks.history).toHaveBeenCalledWith(assignment);
    expect(mocks.receipt).toHaveBeenCalledWith(submission);
    expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ automaticPdf: true, canCorrect: false }));
  });
  it("cannot turn a denied assignment into a receipt by supplying its query", async () => {
    mocks.history.mockRejectedValue(new Error("Forbidden"));
    await expect(AssignedFormPage({ params: Promise.resolve({ assignmentId: assignment }), searchParams: Promise.resolve({ submitted: submission }) })).rejects.toThrow("Not found");
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it("redirects a successful browser submission after revalidation without catching the framework redirect", async () => {
    await expect(submitAssignedFormAction(input, true)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith(`/account/onboarding/${assignment}?submitted=${submission}`);
  });
  it("retains the result contract for non-navigating callers", async () => {
    await expect(submitAssignedFormAction(input)).resolves.toEqual({ ok: true, data: { id: submission, followUp: "not_required" } });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("does not navigate or automatically download after a rejected submission", async () => {
    mocks.submit.mockRejectedValue(new Error("Rejected"));
    expect((await submitAssignedFormAction(input, true)).ok).toBe(false);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
