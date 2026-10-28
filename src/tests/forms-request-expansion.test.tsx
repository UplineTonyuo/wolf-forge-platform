// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../components/forms/form-renderer";
import type { FormPublishedSchema } from "../domain/forms/schema";
import { requestAutomationSchema } from "../domain/forms/request-options";
import { GET as maintenance } from "../app/api/internal/intake-maintenance/route";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), upload: vi.fn(), submit: vi.fn(), info: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../components/forms/download-form-pdf", () => ({ DownloadFormPdf: () => null }));
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
  it("associates field guidance with its input without changing the answer", async () => {
    mount({ ...schema, fields: [{ ...schema.fields[0]!, help_html: "Use the registered business name." }] });
    const input = screen.getByRole("textbox", { name: "Business" });
    const description = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(description?.textContent).toBe("Use the registered business name.");
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "Synthetic company" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByRole("heading", { name: "Submitted" });
    expect(screen.getByRole("status").getAttribute("data-state")).toBe("complete");
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ values: [{ field_key: key, value: "Synthetic company" }] }), true);
  });
  it("displays agreement content without collecting an answer or saving a dummy draft value", async () => {
    mount({ ...schema, fields: [...schema.fields, { ...schema.fields[0]!, stable_field_key: fileId, field_type: "richtext", label: "SEO Agreement", required: false,
      help_html: "First paragraph.\n\nSecond paragraph.", settings: { display_only: true } }] });
    await waitFor(() => expect((screen.getByLabelText(/Business/) as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByRole("heading", { name: "SEO Agreement" })).toBeTruthy();
    const agreement = screen.getByRole("button", { name: "View agreement" });
    expect(agreement.getAttribute("aria-expanded")).toBe("false");
    const policy = document.getElementById(agreement.getAttribute("aria-controls")!);
    expect(policy?.textContent).toBe("First paragraph.\n\nSecond paragraph.");
    expect(policy?.parentElement?.parentElement?.getAttribute("inert")).not.toBeNull();
    fireEvent.click(agreement);
    expect(screen.getByRole("button", { name: "Hide agreement" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("textbox", { name: "SEO Agreement" })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Business/), { target: { value: "Synthetic company" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue later" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.any(String), [{ field_key: key, value: "Synthetic company" }]));
  });
  it("preserves answer collection for previously published richtext fields", () => {
    render(<FormRenderer schema={{ ...schema, fields: [{ ...schema.fields[0]!, field_type: "richtext", label: "Legacy response", settings: {} }] }} />);
    expect(screen.getByRole("textbox", { name: "Legacy response" })).toBeTruthy();
  });
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
    expect(screen.queryByLabelText("Brief", { selector: "input" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect((screen.getByLabelText("Brief", { selector: "input" }) as HTMLInputElement).type).toBe("file");
    expect(screen.queryByRole("link", { name: "synthetic.pdf" })).toBeNull();
  });
  it("rejects an oversized file before sending a hosted request", async () => {
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "file", label: "Brief" }] });
    await waitFor(() => expect((screen.getByLabelText("Brief") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Brief"), { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "too-large.pdf", { type: "application/pdf" })] } });
    await screen.findByText("Choose a file up to 4 MB.");
    expect(mocks.upload).not.toHaveBeenCalled();
    const descriptions = screen.getByLabelText("Brief").getAttribute("aria-describedby")!.split(" ");
    expect(descriptions.map((id) => document.getElementById(id)?.textContent)).toEqual(["Image or PDF · up to 4 MB", "Choose a file up to 4 MB."]);
  });
  it("submits a typed signature with explicit consent", async () => {
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "signature", label: "Signature" }] });
    await waitFor(() => expect((screen.getByLabelText(/Signature/) as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(/Signature/), { target: { value: "Synthetic signer" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I agree to use my typed name/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ values: [{ field_key: key, value: { name: "Synthetic signer", consent: true } }] }), true));
  });
  it("restores and submits a drawn signature through the existing assigned form flow", async () => {
    const signature = { name: "Synthetic signer", consent: true, drawing: [[[10, 20], [100, 80]]] };
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: signature }] } });
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "signature", label: "Signature", settings: { signature_mode: "drawn" } }] });
    await screen.findByText("Your saved draft has been restored.");
    expect(screen.getByRole("img", { name: "Signature drawing area" }).querySelector("polyline")?.getAttribute("points")).toBe("10,20 100,80");
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ values: [{ field_key: key, value: signature }] }), true));
  });
  it("submits valid unnamed ink and explicit consent without adding a name", async () => {
    const signature = { consent: true, drawing: [[[10, 20], [100, 80]]] };
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: signature }] } });
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "signature", label: "Client Agreement", help_html: "<p>Original unchanged agreement.</p>", settings: { signature_mode: "drawn" } }] });
    await screen.findByText("Your saved draft has been restored.");
    expect(screen.queryByRole("textbox", { name: "Full name" })).toBeNull();
    expect(screen.getByRole("button", { name: "View agreement" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ values: [{ field_key: key, value: signature }] }), true));
    expect(screen.getByText("Your responses have been saved.")).toBeTruthy();
    expect(screen.queryByText(/Version [12]/)).toBeNull();
  });
  it("uses the optional service title without exposing client-facing version labels", async () => {
    render(<FormRenderer schema={schema} mode="assigned" assignmentId={fileId} displayTitle="Google Business Review" />);
    expect(screen.getByRole("heading", { name: "Google Business Review" })).toBeTruthy();
    expect(screen.queryByText(/Version [12]/)).toBeNull();
    await waitFor(() => expect((screen.getByLabelText(/Business/) as HTMLInputElement).disabled).toBe(false));
  });
  it("shows saving progress until the draft response resolves, then shows success", async () => {
    let resolve!: (value: { ok: true }) => void;
    mocks.save.mockImplementation(() => new Promise((done) => { resolve = done; }));
    mount();
    const input = screen.getByRole("textbox", { name: "Business" });
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "Pending business" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue later" }));
    const saving = await screen.findByRole("button", { name: "Saving draft…" });
    expect(saving.getAttribute("aria-busy")).toBe("true");
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Draft saved\./)).toBeNull();
    expect(screen.getByRole("button", { name: "Submit Form" }).getAttribute("aria-busy")).toBeNull();
    resolve({ ok: true });
    await screen.findByText(/Draft saved\./);
    expect(screen.getByRole("button", { name: "Save and continue later" }).getAttribute("aria-busy")).toBeNull();
  });
  it("keeps a failed draft editable and never reports a successful save", async () => {
    mocks.save.mockRejectedValue(new Error("connection lost"));
    mount();
    const input = screen.getByRole("textbox", { name: "Business" });
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "Keep this response" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue later" }));
    await screen.findByText("Your draft could not be saved. Check your connection and try again.");
    expect((input as HTMLInputElement).value).toBe("Keep this response");
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(/Draft saved\./)).toBeNull();
  });
  it("reports confirmed order progress after submission using the server-scoped order link", async () => {
    mocks.submit.mockResolvedValue({ ok: true, data: { id: "response", orderStart: { id: fileId, status: "working", requested: true, started: true } } });
    mount();
    await waitFor(() => expect((screen.getByLabelText(/Business/) as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(/Business/), { target: { value: "Synthetic company" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByText("Your order is now in progress.");
    expect(screen.getByRole("link", { name: /View your order/ }).getAttribute("href")).toBe(`/account/projects/${fileId}`);
  });
  it("blocks a typed-name-only bypass of a required drawn signature", async () => {
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: { name: "Synthetic signer", consent: true } }] } });
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "signature", label: "Signature", settings: { signature_mode: "drawn" } }] });
    await screen.findByText("Your saved draft has been restored.");
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await screen.findByText("Draw your signature and confirm consent for Signature.");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("img", { name: "Signature drawing area" }));
  });
  it("saves incomplete ink as a draft without recording consent or submitting an agreement", async () => {
    const signature = { name: "Synthetic signer", consent: false, drawing: [[[10, 20], [100, 80]]] };
    mocks.load.mockResolvedValue({ ok: true, draft: { values: [{ field_key: key, value: signature }] } });
    mount({ ...schema, fields: [{ ...schema.fields[0]!, field_type: "signature", label: "Signature", settings: { signature_mode: "drawn" } }] });
    await screen.findByText("Your saved draft has been restored.");
    fireEvent.click(screen.getByRole("button", { name: "Save and continue later" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.any(String), [{ field_key: key, value: signature }]));
    expect(mocks.submit).not.toHaveBeenCalled();
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
