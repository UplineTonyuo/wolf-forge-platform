/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormCapabilities, FormDetail, FormPublishedSchema } from "../domain/forms/schema";
import type { FormRow, ServiceRow } from "../lib/supabase/database-rows";
import { FormsList } from "../components/forms/forms-list";
import { CreateForm } from "../components/forms/create-form";
import { FormBuilder } from "../components/forms/form-builder";
import { FormRenderer, isFormFieldVisible } from "../components/forms/form-renderer";
import { FormAssignments } from "../components/forms/form-assignments";
import { FormSubmissions } from "../components/forms/form-submissions";
import { SubmissionDetail } from "../components/forms/submission-detail";
import * as actions from "../app/actions/forms";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("../app/actions/forms", () => ({
  createFormAction: vi.fn(), saveFormDraftAction: vi.fn(), publishFormAction: vi.fn(),
  archiveFormAction: vi.fn(), assignFormAction: vi.fn(), submitAssignedFormAction: vi.fn(),
  submitPublicFormAction: vi.fn(), correctFormSubmissionAction: vi.fn(),
  loadFormCollectionAvailability: vi.fn().mockResolvedValue(true),
}));

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: vi.fn(() => `10000000-0000-4000-8000-${String(Math.random()).slice(2, 14).padEnd(12, "0")}`) }, configurable: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actions.loadFormCollectionAvailability).mockResolvedValue(true);
  vi.mocked(actions.createFormAction).mockResolvedValue({ ok: true, data: { id: "form-new" } });
  vi.mocked(actions.saveFormDraftAction).mockResolvedValue({ ok: true, data: { version: 2 } });
  vi.mocked(actions.publishFormAction).mockResolvedValue({ ok: true, data: { version: 2 } });
  vi.mocked(actions.assignFormAction).mockResolvedValue({ ok: true, data: { id: "assignment-new" } });
  vi.mocked(actions.submitAssignedFormAction).mockResolvedValue({ ok: true, data: { id: "submission-new" } });
  vi.mocked(actions.submitPublicFormAction).mockResolvedValue({ ok: true, data: { id: "submission-new" } });
  vi.mocked(actions.correctFormSubmissionAction).mockResolvedValue({ ok: true, data: { id: "correction-new" } });
  vi.mocked(actions.archiveFormAction).mockResolvedValue({ ok: true, data: undefined });
});
afterEach(cleanup);

const capabilities: FormCapabilities = { view: true, manage: true, publish: true, assign: true, submissionsView: true, submissionsManage: true };
const service = { id: "20000000-0000-4000-8000-000000000001", name: "SEO Strategy", price: 497, currency: "USD", is_active: true, folder_id: null } as ServiceRow;
const fieldA = "30000000-0000-4000-8000-000000000001";
const fieldB = "30000000-0000-4000-8000-000000000002";
const optionA = "40000000-0000-4000-8000-000000000001";

function row(overrides: Partial<FormRow> = {}): FormRow {
  return { id: "50000000-0000-4000-8000-000000000001", form_type: "order", canonical_key: "project-brief", name: "Project Brief", status: "published", visibility: "public", current_draft_version_id: "60000000-0000-4000-8000-000000000002", published_version_id: "60000000-0000-4000-8000-000000000001", created_by_profile_id: "70000000-0000-4000-8000-000000000001", updated_by_profile_id: "70000000-0000-4000-8000-000000000001", created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T01:00:00Z", archived_at: null, ...overrides };
}

function detail(formType: FormRow["form_type"] = "order"): FormDetail {
  const form = row({ form_type: formType, visibility: formType === "intake" || formType === "onboarding" ? "assigned" : "public" });
  return {
    form,
    versions: [
      { id: form.published_version_id!, form_id: form.id, version_number: 1, lifecycle_state: "published", title: "Project Brief", information_html: "<p>Tell us about the work.</p>", visibility: form.visibility, type_config: {}, schema_hash: "hash", created_by_profile_id: form.created_by_profile_id, published_by_profile_id: form.created_by_profile_id, created_at: form.created_at, published_at: form.updated_at },
      { id: form.current_draft_version_id!, form_id: form.id, version_number: 2, lifecycle_state: "draft", title: "Project Brief", information_html: "<p>Tell us about the work.</p>", visibility: form.visibility, type_config: {}, schema_hash: null, created_by_profile_id: form.created_by_profile_id, published_by_profile_id: null, created_at: form.updated_at, published_at: null },
    ],
    draftDefinition: {
      name: "Project Brief", title: "Project Brief", information_html: "<p>Tell us about the work.</p>", visibility: form.visibility, type_config: {},
      fields: [
        { stable_field_key: fieldA, sort_order: 0, field_type: "text", label: "Project name", internal_label: "project_name", placeholder: "Acme launch", help_html: null, default_value: null, required: true, settings: {}, options: [], service_links: [] },
        { stable_field_key: fieldB, sort_order: 1, field_type: "data-dropdown", label: "Priority", internal_label: "priority", placeholder: null, help_html: null, default_value: null, required: false, settings: {}, options: [{ stable_option_key: optionA, option_value: "normal", label: "Normal", sort_order: 0, metadata: {} }], service_links: [] },
      ], rules: [], service_links: formType === "intake" ? [{ service_id: service.id, role: "intake_assignment", sort_order: 0, configuration: {} }] : [],
    },
  };
}

function schema(extraFields: FormPublishedSchema["fields"] = []): FormPublishedSchema {
  return { form_id: "form", form_type: "contact", canonical_key: "contact-us", form_version_id: "version", version_number: 3, schema_hash: "hash", title: "Contact us", information_html: "<p>We reply within one business day.</p>", visibility: "public", type_config: {}, fields: [
    { stable_field_key: fieldA, sort_order: 0, field_type: "text", label: "Your name", placeholder: null, help_html: null, default_value: null, required: true, settings: {}, options: [], services: [] }, ...extraFields,
  ], rules: [] };
}

describe("Forms admin list and creation", () => {
  it("renders real Forms and filters by type tabs", () => {
    render(<FormsList forms={[row(), row({ id: "contact", form_type: "contact", name: "Contact Us", canonical_key: "contact-us" })]} capabilities={capabilities} />);
    expect(screen.getAllByText("Project Brief").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Contact Forms/ }));
    expect(screen.getAllByText("Contact Us").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Project Brief")).toHaveLength(0);
  });

  it("searches the authorized result set and shows an intentional empty state", () => {
    render(<FormsList forms={[row()]} capabilities={capabilities} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No Forms match your search.")).toBeInTheDocument();
  });

  it("creates an idempotent draft from a selected Form type", async () => {
    render(<CreateForm services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: /Onboarding Forms/ }));
    fireEvent.change(screen.getByLabelText("Form name"), { target: { value: "Client Onboarding" } });
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));
    await waitFor(() => expect(actions.createFormAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.createFormAction).mock.calls[0]![0]).toMatchObject({ form_type: "onboarding", canonical_key: "client-onboarding", definition: { visibility: "assigned" } });
  });

  it("requires a real Service before creating an Intake draft", async () => {
    render(<CreateForm services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: /Intake Forms/ }));
    fireEvent.change(screen.getByLabelText("Form name"), { target: { value: "Project Intake" } });
    expect(screen.getByRole("button", { name: /Create draft/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Intake Service: Choose a service" }));
    fireEvent.click(screen.getByRole("option", { name: /Unfiled/ }));
    fireEvent.click(await screen.findByRole("option", { name: /SEO Strategy/ }));
    expect(screen.getByRole("button", { name: /Create draft/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));
    await waitFor(() => expect(actions.createFormAction).toHaveBeenCalled());
    expect(vi.mocked(actions.createFormAction).mock.calls[0]![0].definition.service_links[0]?.service_id).toBe(service.id);
  });
});

describe("visual builder", () => {
  it("adds supported fields and edits the selected field", () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Email" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Work email" } });
    expect(screen.getByText("Work email")).toBeInTheDocument();
  });

  it("reorders fields through keyboard-operable buttons", () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Priority up" }));
    const fields = screen.getAllByRole("article");
    expect(within(fields[0]!).getByText("Priority")).toBeInTheDocument();
  });

  it("adds, renames, reorders, and removes stable-key options", () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByText("Priority"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const second = screen.getByLabelText("Option 2");
    fireEvent.change(second, { target: { value: "Urgent" } });
    expect(second).toHaveValue("Urgent");
    fireEvent.click(screen.getAllByRole("button", { name: "Move option up" })[1]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove option" })[1]!);
    expect(screen.getByLabelText("Option 1")).toHaveValue("Urgent");
  });

  it("builds only the backend-supported simple conditional rule", () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByText("Priority"));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    expect(screen.getByLabelText("Condition field")).toBeInTheDocument();
    expect(screen.getByLabelText("Comparator")).toHaveValue("equals");
    expect(screen.queryByText(/OR group/i)).not.toBeInTheDocument();
  });

  it("saves the real normalized draft intentionally", async () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Draft Version 2 saved")).toBeInTheDocument();
  });

  it("persists a custom Visibility selection through the custom select", async () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Visibility: Public" }));
    fireEvent.click(screen.getByRole("option", { name: "Assigned" }));
    expect(document.querySelector('input[name="visibility"]')).toHaveValue("assigned");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.saveFormDraftAction).mock.calls[0]![1].definition.visibility).toBe("assigned");
  });

  it("persists a folder-first intake Service selection from the builder", async () => {
    const folderId = "5e000000-0000-4000-8000-000000000001";
    const secondService = { ...service, id: "20000000-0000-4000-8000-000000000002", name: "Local SEO", folder_id: folderId } as ServiceRow;
    render(
      <FormBuilder
        detail={detail("intake")}
        capabilities={capabilities}
        services={[{ ...service, folder_id: folderId } as ServiceRow, secondService]}
        folders={[{ id: folderId, name: "SEO" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Intake Service: SEO Strategy" }));
    fireEvent.click(screen.getByRole("option", { name: /SEO\s*2 services/u }));
    fireEvent.click(screen.getByRole("option", { name: /Local SEO/u }));
    expect(document.querySelector('input[name="service_id"]')).toHaveValue(secondService.id);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.saveFormDraftAction).mock.calls[0]![1].definition.service_links[0]?.service_id).toBe(secondService.id);
  });

  it("previews the current draft through the shared renderer", () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getAllByText("Draft Preview").length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "Project Brief" })).toBeInTheDocument();
  });

  it("publishes only after saving and explains immutability", async () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByText(/Published versions are immutable/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Publish this version?" })).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(actions.publishFormAction).toHaveBeenCalledTimes(1));
    expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1);
  });

  it("archives through a real pending mutation, and surfaces a failure instead of silently dropping it", async () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog", { name: "Archive this Form?" });
    const confirm = within(dialog).getByRole("button", { name: "Archive Form" });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(actions.archiveFormAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Archive this Form?" })).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the archive dialog open and shows the error on failure, instead of failing silently", async () => {
    vi.mocked(actions.archiveFormAction).mockResolvedValueOnce({ ok: false, error: "Forms with pending submissions cannot be archived." });
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog", { name: "Archive this Form?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive Form" }));
    expect(await within(dialog).findByText("Forms with pending submissions cannot be archived.")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it("shows real version history and published read-only links", () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getByText("Current draft")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", expect.stringContaining("/versions/"));
  });

  it("hides Order-only and profile fields on Intake Forms", () => {
    render(<FormBuilder detail={detail("intake")} capabilities={capabilities} services={[service]} />);
    expect(screen.queryByRole("button", { name: "Payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Email" })).not.toBeInTheDocument();
    expect(document.querySelector('input[name="service_id"]')).toHaveValue(service.id);
  });
});

describe("renderer and safety", () => {
  it("applies the same AND conditional semantics as the backend", () => {
    const rules: FormPublishedSchema["rules"] = [{ rule_key: "rule", sort_order: 0, action: "show", target_field_keys: [fieldB], conditions: [{ field_key: fieldA, comparator: "equals", value: "yes" }] }];
    expect(isFormFieldVisible(fieldB, rules, { [fieldA]: "no" })).toBe(false);
    expect(isFormFieldVisible(fieldB, rules, { [fieldA]: "yes" })).toBe(true);
  });

  it("never collects secrets or fakes file upload and strips unsafe HTML", () => {
    render(<FormRenderer mode="preview" schema={schema([
      { stable_field_key: "secret", sort_order: 1, field_type: "secret", label: "Credentials", placeholder: null, help_html: null, default_value: null, required: false, settings: { collection_mode: "disabled" }, options: [], services: [] },
      { stable_field_key: "file", sort_order: 2, field_type: "file", label: "Upload", placeholder: null, help_html: null, default_value: null, required: false, settings: {}, options: [], services: [] },
      { stable_field_key: "html", sort_order: 3, field_type: "html", label: "HTML", placeholder: null, help_html: null, default_value: null, required: false, settings: { html: "<p>Safe</p><script>alert(1)</script>" }, options: [], services: [] },
    ])} />);
    expect(screen.getByText(/Secure secret collection is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/File upload is not enabled/)).toBeInTheDocument();
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByLabelText("Credentials")).not.toBeInTheDocument();
  });

  it("prevents duplicate submission and shows completion from the real action", async () => {
    render(<FormRenderer mode="public" schema={schema()} />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Jane" } });
    const submit = screen.getByRole("button", { name: "Submit Form" });
    fireEvent.click(submit); fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText("Submitted")).toBeInTheDocument());
    expect(actions.submitPublicFormAction).toHaveBeenCalledTimes(1);
  });

  it("removes stale collection controls when the current Form becomes unavailable", async () => {
    vi.mocked(actions.loadFormCollectionAvailability).mockResolvedValue(false);
    render(<FormRenderer mode="public" schema={schema()} />);
    await waitFor(() => expect(screen.getByText("Form collection is unavailable")).toBeInTheDocument());
    expect(actions.loadFormCollectionAvailability).toHaveBeenCalledWith(schema().canonical_key, schema().form_version_id);
    expect(screen.queryByRole("button", { name: "Submit Form" })).not.toBeInTheDocument();
    expect(actions.submitPublicFormAction).not.toHaveBeenCalled();
  });

  it("validates and focuses a required custom choice before sending a response", () => {
    render(<FormRenderer mode="public" schema={schema([
      { stable_field_key: fieldB, sort_order: 1, field_type: "data-dropdown", label: "Required priority", placeholder: null, help_html: null, default_value: null, required: true, settings: {}, options: [{ option_id: optionA, value: "normal", label: "Normal", sort_order: 0, metadata: {} }], services: [] },
    ])} />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Jane" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    expect(screen.getByText("Choose a value for Required priority.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Required priority:/ })).toHaveFocus();
    expect(actions.submitPublicFormAction).not.toHaveBeenCalled();
  });

  it("retains the accepted acknowledgement through a later availability change", async () => {
    render(<FormRenderer mode="public" schema={schema()} />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Jane" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(screen.getByText("Submitted")).toBeInTheDocument());
    vi.mocked(actions.loadFormCollectionAvailability).mockResolvedValue(false);
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(actions.loadFormCollectionAvailability).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(actions.submitPublicFormAction).toHaveBeenCalledTimes(1);
  });

  it("omits an unanswered optional date without losing the supplied required answer", async () => {
    render(<FormRenderer mode="public" schema={schema([
      { stable_field_key: fieldB, sort_order: 1, field_type: "date", label: "Optional date", placeholder: null, help_html: null, default_value: null, required: false, settings: {}, options: [], services: [] },
    ])} />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Jane" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Form" }));
    await waitFor(() => expect(actions.submitPublicFormAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.submitPublicFormAction).mock.calls[0]?.[0].values).toEqual([{ field_key: fieldA, value: "Jane" }]);
  });
});

describe("assignments, submissions, and client experience", () => {
  /*
   * The client-facing view of an assignment now lives in the portal's
   * Onboarding surface and is covered by client-portal-dashboard.test.tsx.
   * What remains here is the internal assignment and submission boundary.
   */
  it("assigns Onboarding Forms through the real client boundary", async () => {
    render(<FormAssignments formId="form" formType="onboarding" assignments={[]} options={[{ id: "client", label: "Jane Client", detail: "Acme" }]} />);
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "client" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign Form" }));
    await waitFor(() => expect(actions.assignFormAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.assignFormAction).mock.calls[0]![1].context).toMatchObject({ client_profile_id: "client" });
  });


  it("links submissions to exact historical detail and labels corrections", () => {
    render(<FormSubmissions submissions={[{ id: "submission", form_id: "form", form_version_id: "version-1", form_assignment_id: "assignment", company_id: "company", client_profile_id: "client", order_id: null, revision_number: 2, status: "submitted", submitted_at: "2026-08-14T00:00:00Z", submitted_by_profile_id: "client", supersedes_submission_id: "original" }]} />);
    expect(screen.getByText("Correction 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View exact answers/ })).toHaveAttribute("href", "/forms/submissions/submission");
  });

  it("shows original answers and starts an append-only correction", () => {
    render(<SubmissionDetail canCorrect detail={{ submission: { id: "submission", form_id: "form", form_version_id: "version", form_assignment_id: null, company_id: "company", client_profile_id: null, order_id: null, root_submission_id: "submission", revision_number: 1, status: "submitted", orchestration_type: null, orchestration_status: "not_applicable", submitted_at: "2026-08-14T00:00:00Z", submitted_by_profile_id: "staff", supersedes_submission_id: null, provenance: {} }, values: [{ stable_field_key: fieldA, label: "Name", field_type: "text", sort_order: 0, value: "Jane" }] }} />);
    expect(screen.getByText("Original submission")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Correct submission" }));
    expect(screen.getByText("Create a correction")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jane")).toBeInTheDocument();
  });
});
