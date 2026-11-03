// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../components/forms/form-renderer";
import type { FormPublishedSchema } from "../domain/forms/schema";

const mocks = vi.hoisted(() => ({ capture: vi.fn(), load: vi.fn(), save: vi.fn(), submit: vi.fn() }));
vi.mock("../app/actions/intake-secrets", () => ({ captureIntakeSecret: mocks.capture }));
vi.mock("../app/actions/intake-drafts", () => ({ loadIntakeDraft: mocks.load, saveIntakeDraft: mocks.save }));
vi.mock("../app/actions/forms", () => ({ submitAssignedFormAction: mocks.submit, submitPublicFormAction: mocks.submit, loadFormCollectionAvailability: vi.fn().mockResolvedValue(true) }));
vi.mock("../components/forms/download-form-pdf", () => ({ DownloadFormPdf: () => null }));
const key = "a0000000-0000-4000-8000-000000000001";
const assignment = "b0000000-0000-4000-8000-000000000001";
const reference = { credential_id: "c0000000-0000-4000-8000-000000000001" };
const password = "synthetic-wp-password";
const schema: FormPublishedSchema = {
  form_id: "d0000000-0000-4000-8000-000000000001", form_type: "intake", canonical_key: "credential-test",
  form_version_id: "e0000000-0000-4000-8000-000000000001", version_number: 1, schema_hash: "synthetic",
  title: "WordPress information", visibility: "assigned", information_html: null, type_config: {}, rules: [],
  fields: [{ stable_field_key: key, sort_order: 0, field_type: "secret", label: "WordPress password", required: true,
    placeholder: null, help_html: null, default_value: null, settings: { collection_mode: "encrypted" }, options: [], services: [] }],
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const input = () => screen.getByLabelText(/WordPress password/, { selector: "input" }) as HTMLInputElement;
async function mount() {
  const view = render(<FormRenderer schema={schema} mode="assigned" assignmentId={assignment} />);
  await waitFor(() => expect(input()).not.toBeDisabled());
  return view;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ ok: true, draft: null });
  mocks.capture.mockResolvedValue({ ok: true, reference });
  mocks.save.mockResolvedValue({ ok: true });
  mocks.submit.mockResolvedValue({ ok: true, data: { id: "f0000000-0000-4000-8000-000000000001" } });
});
afterEach(cleanup);

describe("encrypted assigned intake password capture", () => {
  it("captures an explicitly authorized legacy field without changing its frozen settings", async () => {
    const legacy = { ...schema, fields: [{ ...schema.fields[0]!, settings: { collection_mode: "disabled" }, encrypted_collection_allowed: true }] };
    render(<FormRenderer schema={legacy} mode="assigned" assignmentId={assignment} />);
    await waitFor(() => expect(input()).not.toBeDisabled());
    fireEvent.change(input(), { target: { value: "synthetic-legacy-example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue later" }));
    await screen.findByText(/Draft saved\./);
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith(assignment, [{ field_key: key, value: reference }]);
    expect(legacy.fields[0]!.settings.collection_mode).toBe("disabled");
  });
  it.each(["public", "preview", "readonly"] as const)("does not enable a projected legacy field in %s mode", (mode) => {
    render(<FormRenderer schema={{ ...schema, fields: [{ ...schema.fields[0]!, settings: { collection_mode: "disabled" }, encrypted_collection_allowed: true }] }} mode={mode} />);
    expect(screen.queryByLabelText(/WordPress password/, { selector: "input" })).toBeNull();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("keeps unapproved disabled fields disabled", () => {
    render(<FormRenderer schema={{ ...schema, fields: [{ ...schema.fields[0]!, settings: { collection_mode: "disabled" } }] }} mode="assigned" assignmentId={assignment} />);
    expect(screen.queryByLabelText(/WordPress password/, { selector: "input" })).toBeNull();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("requires a value or an existing encrypted reference before submission", async () => {
    await mount();
    fireEvent.submit(input().closest("form")!);
    await screen.findByText("Enter a password before submitting.");
    expect(input()).toHaveFocus();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("uses a labelled password control and sends only its opaque reference to submission", async () => {
    await mount();
    expect(input().type).toBe("password");
    fireEvent.change(input(), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Show WordPress password" }));
    expect(input().type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide WordPress password" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByRole("heading", { name: "Submitted" });
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith({ request_id: expect.any(String), assignment_id: assignment, field_key: key, secret: password });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ values: [{ field_key: key, value: reference }] }), true);
    expect(JSON.stringify(mocks.submit.mock.calls)).not.toContain(password);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("never submits after capture failure and retries the same unchanged capture request", async () => {
    mocks.capture.mockResolvedValueOnce({ ok: false, error: "The password could not be saved. Try again." });
    await mount();
    fireEvent.change(input(), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByText("The password could not be saved. Try again.");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByText("Password saved securely.")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Form" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByRole("heading", { name: "Submitted" });
    expect(mocks.capture.mock.calls[0]).toEqual(mocks.capture.mock.calls[1]);
  });

  it("saves encrypted data first and does not claim the draft is saved before its write finishes", async () => {
    const capture = deferred<{ ok: true; reference: typeof reference }>();
    const save = deferred<{ ok: true }>();
    mocks.capture.mockReturnValue(capture.promise); mocks.save.mockReturnValue(save.promise);
    await mount();
    fireEvent.change(input(), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue later" }));
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByText("Password saved securely.")).toBeNull();
    await act(async () => capture.resolve({ ok: true, reference }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith(assignment, [{ field_key: key, value: reference }]));
    expect(input().value).toBe("");
    expect(screen.queryByText(/Draft saved\./)).toBeNull();
    expect(JSON.stringify(mocks.save.mock.calls)).not.toContain(password);
    await act(async () => save.resolve({ ok: true }));
    await screen.findByText(/Draft saved\./);
  });

  it("restores a saved reference without recovering plaintext or recapturing it", async () => {
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: reference }] } });
    await mount();
    expect(input().value).toBe("");
    expect(screen.getByText("Password saved securely.")).toBeVisible();
    expect(input()).not.toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByRole("heading", { name: "Submitted" });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ values: [{ field_key: key, value: reference }] }), true);
  });

  it("ignores a capture response after an edit and gives the replacement a new request id", async () => {
    const capture = deferred<{ ok: true; reference: typeof reference }>();
    mocks.capture.mockReturnValueOnce(capture.promise);
    await mount();
    fireEvent.change(input(), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    fireEvent.change(input(), { target: { value: "replacement-synthetic-password" } });
    await act(async () => capture.resolve({ ok: true, reference }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(input().value).toBe("replacement-synthetic-password");
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Form" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByRole("heading", { name: "Submitted" });
    expect(mocks.capture.mock.calls[1]![0].request_id).not.toBe(mocks.capture.mock.calls[0]![0].request_id);
    expect(mocks.capture.mock.calls[1]![0].secret).toBe("replacement-synthetic-password");
  });

  it("discards pending plaintext and late capture results when the assignment changes", async () => {
    const capture = deferred<{ ok: true; reference: typeof reference }>();
    mocks.capture.mockReturnValueOnce(capture.promise);
    const view = await mount();
    fireEvent.change(input(), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    view.rerender(<FormRenderer schema={schema} mode="assigned" assignmentId="b0000000-0000-4000-8000-000000000002" />);
    await act(async () => capture.resolve({ ok: true, reference }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(input().value).toBe("");
    expect(screen.queryByText("Password saved securely.")).toBeNull();
  });

  it("does not restore an old draft over edits when an RSC refresh clones the same immutable schema", async () => {
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: reference }] } });
    const view = await mount();
    fireEvent.change(input(), { target: { value: password } });
    view.rerender(<FormRenderer schema={{ ...schema, fields: schema.fields.map((field) => ({ ...field })) }} mode="assigned" assignmentId={assignment} />);
    await act(async () => {});
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(input().value).toBe(password);
    expect(screen.queryByText("Password saved securely.")).toBeNull();
  });

  it("reuses encrypted capture after the ordinary submission response fails", async () => {
    mocks.submit.mockResolvedValueOnce({ ok: false, error: "Submission unavailable" });
    await mount();
    fireEvent.change(input(), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByText("Submission unavailable");
    expect(input().value).toBe("");
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Form" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByRole("heading", { name: "Submitted" });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.submit.mock.calls[1]![0].values).toEqual([{ field_key: key, value: reference }]);
  });

  it("supports encrypted assigned onboarding while keeping disabled and public collection inactive", async () => {
    const view = render(<FormRenderer schema={{ ...schema, fields: [{ ...schema.fields[0]!, settings: { collection_mode: "disabled" }, required: false }] }} mode="assigned" assignmentId={assignment} />);
    expect(screen.queryByLabelText(/WordPress password/, { selector: "input" })).toBeNull();
    view.rerender(<FormRenderer schema={schema} mode="public" />);
    expect(screen.queryByLabelText(/WordPress password/, { selector: "input" })).toBeNull();
    view.rerender(<FormRenderer schema={{ ...schema, form_type: "onboarding" }} mode="assigned" assignmentId={assignment} />);
    await waitFor(() => expect(input()).not.toBeDisabled());
    expect(input().type).toBe("password");
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
