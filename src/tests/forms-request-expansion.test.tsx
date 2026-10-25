// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../components/forms/form-renderer";
import type { FormPublishedSchema } from "../domain/forms/schema";
import { requestAutomationSchema } from "../domain/forms/request-options";
import { GET as maintenance } from "../app/api/internal/intake-maintenance/route";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), upload: vi.fn(), submit: vi.fn(), info: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../app/actions/intake-drafts", () => ({ loadIntakeDraft: mocks.load, saveIntakeDraft: mocks.save }));
vi.mock("../app/actions/intake-files", () => ({ uploadIntakeFile: mocks.upload, loadIntakeFileInfo: mocks.info }));
vi.mock("../app/actions/forms", () => ({ submitAssignedFormAction: mocks.submit, submitPublicFormAction: mocks.submit, loadFormCollectionAvailability: vi.fn().mockResolvedValue(true) }));
const key = "10000000-0000-4000-8000-000000000001";
const fileId = "20000000-0000-4000-8000-000000000001";
const schema: FormPublishedSchema = {
  form_id: "30000000-0000-4000-8000-000000000001", form_type: "onboarding", canonical_key: "request-qa",
  form_version_id: "40000000-0000-4000-8000-000000000001", version_number: 1, schema_hash: "qa", title: "Request QA",
  visibility: "assigned", information_html: null, type_config: {}, rules: [],
  fields: [{ stable_field_key: key, sort_order: 0, field_type: "text", label: "Business", required: true,
    placeholder: null, help_html: null, default_value: null, settings: {}, options: [], services: [] }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ ok: true, draft: null });
  mocks.save.mockResolvedValue({ ok: true });
  mocks.submit.mockResolvedValue({ ok: true, data: { id: "response" } });
  mocks.info.mockResolvedValue({ ok: true, file: { id: fileId, name: "synthetic.pdf", size: 100 } });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
function mount(value = schema) { return render(<FormRenderer schema={value} mode="assigned" assignmentId="50000000-0000-4000-8000-000000000001" />); }

describe("saved intake forms", () => {
  it("restores answers from the server before accepting edits", async () => {
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: "Saved business" }] } });
    mount();
    await waitFor(() => expect((screen.getByLabelText(/Business/) as HTMLInputElement).value).toBe("Saved business"));
    fireEvent.change(screen.getByLabelText(/Business/), { target: { value: "Updated business" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue later" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.any(String), [{ field_key: key, value: "Updated business" }]));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByText(/Draft saved/)).toBeTruthy();
  });
  it("refuses to overwrite an unreadable existing draft", async () => {
    mocks.load.mockResolvedValue({ ok: false, error: "Saved form unavailable" });
    mount();
    await screen.findByText("Saved form unavailable");
    expect((screen.getByLabelText(/Business/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Submit Form" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Retry saved draft" })).toBeTruthy();
  });
  it("restores private file references with the draft", async () => {
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: [fileId] }] } });
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "file", label: "Brief" }] });
    const link = await screen.findByRole("link", { name: "synthetic.pdf" });
    expect(link.getAttribute("href")).toBe(`/api/intake-files/${fileId}`);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects an oversized file before sending a hosted request", async () => {
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "file", label: "Brief" }] });
    await waitFor(() => expect((screen.getByLabelText("Brief") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Brief"), { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "too-large.pdf", { type: "application/pdf" })] } });
    await screen.findByText("Choose a file up to 4 MB.");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("submits a typed signature with explicit consent", async () => {
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "signature", label: "Signature" }] });
    await waitFor(() => expect((screen.getByLabelText(/Signature/) as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(/Signature/), { target: { value: "Synthetic signer" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I agree to use my typed name/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ values: [{ field_key: key, value: { name: "Synthetic signer", consent: true } }] })));
  });
});

describe("configured follow-up boundaries", () => {
  it("requires an actual Service and title before enabling project creation", () => {
    expect(requestAutomationSchema.safeParse({ create_project: true }).success).toBe(false);
    expect(requestAutomationSchema.safeParse({ create_project: true, service_id: fileId, project_title: "New request" }).success).toBe(true);
    expect(requestAutomationSchema.safeParse({ workflow_steps: Array.from({ length: 21 }, () => "Task") }).success).toBe(false);
  });
  it("does not run scheduled work without configuration and authentication", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await maintenance(new Request("http://localhost/api/internal/intake-maintenance"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "x".repeat(32));
    expect((await maintenance(new Request("http://localhost/api/internal/intake-maintenance"))).status).toBe(401);
  });
});
