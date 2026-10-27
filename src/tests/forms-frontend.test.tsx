/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormSchema, type FormCapabilities, type FormDetail, type FormPublishedSchema } from "../domain/forms/schema";
import reviewed147Json from "../../data/intake-forms/20261028/drafts/intake-147.json";
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
vi.mock("../components/forms/download-form-pdf", () => ({ DownloadFormPdf: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("../app/actions/forms", () => ({
  createFormAction: vi.fn(), saveFormDraftAction: vi.fn(), publishFormAction: vi.fn(),
  archiveFormAction: vi.fn(), assignFormAction: vi.fn(), submitAssignedFormAction: vi.fn(),
  submitPublicFormAction: vi.fn(), correctFormSubmissionAction: vi.fn(),
  loadFormCollectionAvailability: vi.fn().mockResolvedValue(true),
}));
vi.mock("../app/actions/intake-drafts", () => ({ loadIntakeDraft: vi.fn().mockResolvedValue({ ok: true, draft: null }), saveIntakeDraft: vi.fn().mockResolvedValue({ ok: true }), loadIntakeFollowUp: vi.fn().mockResolvedValue("not_required") }));
vi.mock("../app/actions/intake-files", () => ({ loadIntakeFileInfo: vi.fn(), uploadIntakeFile: vi.fn() }));

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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const capabilities: FormCapabilities = { view: true, manage: true, publish: true, assign: true, submissionsView: true, submissionsManage: true };
const service = { id: "20000000-0000-4000-8000-000000000001", name: "SEO Strategy", price: 497, currency: "USD", is_active: true, folder_id: null } as ServiceRow;
const fieldA = "30000000-0000-4000-8000-000000000001";
const fieldB = "30000000-0000-4000-8000-000000000002";
const optionA = "40000000-0000-4000-8000-000000000001";
const { request_id: reviewedRequestId, ...reviewed147Payload } = createFormSchema.parse(reviewed147Json);
const reviewed147 = { file: "intake-147.json", ...reviewed147Payload };
const reviewed147Options = [{ file: reviewed147.file, label: reviewed147.definition.name, fieldCount: reviewed147.definition.fields.length, serviceCount: reviewed147.definition.service_links.length }];

function mockViewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: width <= Number(query.match(/max-width:\s*(\d+)px/u)?.[1] ?? 0), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

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

  it("creates a reviewed intake with every field and mapped Service only after explicit submission", async () => {
    render(<CreateForm services={[]} reviewedTemplates={reviewed147Options} reviewedTemplate={reviewed147} />);
    expect(screen.getByLabelText("Form name")).toHaveValue(reviewed147.definition.name);
    expect(screen.getByLabelText("Public slug")).toHaveValue(reviewed147.canonical_key);
    expect(screen.getByText("13 fields · 6 linked services")).toBeInTheDocument();
    expect(actions.createFormAction).not.toHaveBeenCalled();
    expect(actions.publishFormAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Form name"), { target: { value: "Reviewed template copy" } });
    fireEvent.change(screen.getByLabelText("Public slug"), { target: { value: "reviewed-template-copy" } });
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));
    await waitFor(() => expect(actions.createFormAction).toHaveBeenCalledTimes(1));
    const input = vi.mocked(actions.createFormAction).mock.calls[0]![0];
    expect(input).toEqual({ ...reviewed147Payload, request_id: expect.any(String), canonical_key: "reviewed-template-copy", definition: { ...reviewed147.definition, name: "Reviewed template copy" } });
    expect(input.request_id).not.toBe(reviewedRequestId);
    expect(actions.publishFormAction).not.toHaveBeenCalled();
  });

  it("navigates to a reviewed template without creating or publishing a Form", () => {
    render(<CreateForm services={[]} reviewedTemplates={reviewed147Options} />);
    fireEvent.click(screen.getByRole("button", { name: "Reviewed intake template: Start with a blank Form" }));
    fireEvent.click(screen.getByRole("option", { name: new RegExp(reviewed147.definition.name) }));
    expect(push).toHaveBeenCalledWith("/forms/new?template=intake-147.json");
    expect(actions.createFormAction).not.toHaveBeenCalled();
    expect(actions.publishFormAction).not.toHaveBeenCalled();
  });

  it("disables the template chooser while a draft creation is pending", async () => {
    let complete!: (result: Awaited<ReturnType<typeof actions.createFormAction>>) => void;
    vi.mocked(actions.createFormAction).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    render(<CreateForm services={[]} reviewedTemplates={reviewed147Options} reviewedTemplate={reviewed147} />);
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));
    expect(screen.getByRole("button", { name: `Reviewed intake template: ${reviewed147.definition.name}` })).toBeDisabled();
    expect(screen.getByLabelText("Form name")).toBeDisabled();
    complete({ ok: false, error: "Draft creation did not finish" });
    await screen.findByText("Draft creation did not finish");
  });

  it("retries the same blank draft payload and request ID, and gives changed content a new request ID", async () => {
    vi.mocked(actions.createFormAction).mockResolvedValueOnce({ ok: false, error: "Retry the same draft" }).mockResolvedValueOnce({ ok: false, error: "Retry unchanged" });
    render(<CreateForm services={[]} />);
    fireEvent.change(screen.getByLabelText("Form name"), { target: { value: "Blank workflow" } });
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));
    await screen.findByText("Retry the same draft");
    await waitFor(() => expect(screen.getByRole("button", { name: /Create draft/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));
    await screen.findByText("Retry unchanged");
    await waitFor(() => expect(screen.getByRole("button", { name: /Create draft/ })).toBeEnabled());
    const [first, retry] = vi.mocked(actions.createFormAction).mock.calls.map(([input]) => input);
    expect(retry).toEqual(first);
    expect(first?.definition.fields).toHaveLength(1);
    expect(first?.definition.fields[0]?.field_type).toBe("fullname");
    fireEvent.change(screen.getByLabelText("Form name"), { target: { value: "Changed blank workflow" } });
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));
    await waitFor(() => expect(actions.createFormAction).toHaveBeenCalledTimes(3));
    expect(vi.mocked(actions.createFormAction).mock.calls[2]![0].request_id).not.toBe(first?.request_id);
  });
});

describe("visual builder", () => {
  it("defaults new signatures to drawing and lets the author preserve typed signing explicitly", async () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Signature$/ }));
    const toggle = screen.getByRole("checkbox", { name: /Draw signature on screen/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
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
    expect(screen.getByRole("button", { name: /Condition field:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comparator: equals" })).toBeInTheDocument();
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

  it("adds a folder-first intake Service without replacing the existing link", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Add Intake Service: Choose a service" }));
    fireEvent.click(screen.getByRole("option", { name: /SEO\s*1 service/u }));
    fireEvent.click(screen.getByRole("option", { name: /Local SEO/u }));
    expect(screen.getByText("2 linked services")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.saveFormDraftAction).mock.calls[0]![1].definition.service_links).toEqual([
      ...detail("intake").draftDefinition.service_links,
      { service_id: secondService.id, role: "intake_assignment", sort_order: 1, configuration: {} },
    ]);
  });

  it("preserves all six shared intake links and their configuration when editing a field", async () => {
    const intake = detail("intake");
    intake.draftDefinition.service_links = Array.from({ length: 6 }, (_, index) => ({
      service_id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      role: "intake_assignment",
      sort_order: index,
      configuration: { bundle_key: `entry-${index + 1}`, enabled: true },
    }));
    const originalLinks = structuredClone(intake.draftDefinition.service_links);
    render(<FormBuilder detail={intake} capabilities={capabilities} services={[service]} />);
    expect(screen.getByText("6 linked services").closest("details")).not.toHaveAttribute("open");
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Updated project name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.saveFormDraftAction).mock.calls[0]![1].definition.service_links).toEqual(originalLinks);
  });

  it("does not offer a duplicate intake link while allowing an existing service with a different role", async () => {
    const intake = detail("intake");
    const secondService = { ...service, id: "20000000-0000-4000-8000-000000000002", name: "Local SEO" } as ServiceRow;
    intake.draftDefinition.service_links.push({ service_id: secondService.id, role: "default_item", sort_order: 1, configuration: { keep: "default configuration" } });
    const originalLinks = structuredClone(intake.draftDefinition.service_links);
    render(<FormBuilder detail={intake} capabilities={capabilities} services={[service, secondService]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Intake Service: Choose a service" }));
    fireEvent.click(screen.getByRole("option", { name: /Unfiled/ }));
    expect(screen.queryByRole("option", { name: /SEO Strategy/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Local SEO/ }));
    expect(screen.getByText("3 linked services")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Intake Service: Choose a service" }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close service picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.saveFormDraftAction).mock.calls[0]![1].definition.service_links).toEqual([
      ...originalLinks,
      { service_id: secondService.id, role: "intake_assignment", sort_order: 2, configuration: {} },
    ]);
  });

  it("removes only the chosen service and role while preserving inactive and unavailable links", async () => {
    const intake = detail("intake");
    intake.draftDefinition.service_links.push(
      { service_id: service.id, role: "default_item", sort_order: 1, configuration: { keep: "same service, other role" } },
      { service_id: "20000000-0000-4000-8000-000000000099", role: "intake_assignment", sort_order: 2, configuration: { keep: "unavailable service" } },
    );
    const remainingLinks = intake.draftDefinition.service_links.slice(1).map((link, sort_order) => ({ ...link, sort_order }));
    render(<FormBuilder detail={intake} capabilities={capabilities} services={[{ ...service, is_active: false }]} />);
    fireEvent.click(screen.getByText("Manage"));
    expect(screen.getByText(/Unavailable service \(20000000-0000-4000-8000-000000000099\)/)).toBeInTheDocument();
    expect(screen.getByText("Default service · Inactive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove SEO Strategy (Intake assignment)" }));
    expect(screen.getByText("2 linked services")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove SEO Strategy (Default service)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.saveFormDraftAction).mock.calls[0]![1].definition.service_links).toEqual(remainingLinks);
  });

  it("removes only the selected Service when two linked Services share the same name", async () => {
    const intake = detail("intake");
    const secondService = { ...service, id: "20000000-0000-4000-8000-000000000002" } as ServiceRow;
    intake.draftDefinition.service_links.push({ service_id: secondService.id, role: "intake_assignment", sort_order: 1, configuration: { duplicate_name: true } });
    render(<FormBuilder detail={intake} capabilities={capabilities} services={[service, secondService]} />);
    fireEvent.click(screen.getByText("Manage"));
    const secondRow = screen.getAllByRole("listitem").find((item) => item.dataset.serviceId === secondService.id);
    fireEvent.click(within(secondRow!).getByRole("button", { name: "Remove SEO Strategy (Intake assignment)" }));
    expect(screen.getByText("1 linked service")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.saveFormDraftAction).mock.calls[0]![1].definition.service_links).toEqual(detail("intake").draftDefinition.service_links);
  });

  it("previews the current draft through the shared renderer", () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getAllByText("Draft Preview").length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "Project Brief" })).toBeInTheDocument();
  });

  it("contains preview focus, dismisses with Escape, and returns to the opener without saving", async () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    const opener = screen.getByRole("button", { name: "Preview" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Project Brief" });
    expect(dialog).toHaveFocus();
    const close = within(dialog).getByRole("button", { name: "Close" });
    close.focus();
    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(false);
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(actions.saveFormDraftAction).not.toHaveBeenCalled();
  });

  it("cancels publication with Escape while preserving unsaved edits and making no mutation", async () => {
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Unsaved title" } });
    const opener = screen.getByRole("button", { name: "Publish" }); opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Publish this version?" });
    const cancel = within(dialog).getByRole("button", { name: "Keep editing" });
    const confirm = within(dialog).getByRole("button", { name: "Publish" });
    cancel.focus(); fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Label")).toHaveValue("Unsaved title");
    expect(opener).toHaveFocus();
    expect(actions.publishFormAction).not.toHaveBeenCalled();
    expect(actions.saveFormDraftAction).not.toHaveBeenCalled();
  });

  it("retains selected field edits after dismissing and reopening the mobile settings sheet", async () => {
    mockViewport(390);
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    const opener = screen.getByRole("button", { name: "Field settings" }); opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Text settings" });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Mobile unsaved title" } });
    fireEvent.keyDown(within(dialog).getByLabelText("Label"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    expect(within(screen.getByRole("dialog", { name: "Text settings" })).getByLabelText("Label")).toHaveValue("Mobile unsaved title");
    expect(actions.saveFormDraftAction).not.toHaveBeenCalled();
  });

  it("dismisses a nested comparator before its settings sheet and retains the unsaved field", async () => {
    mockViewport(390);
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    fireEvent.click(screen.getByRole("button", { name: "Field settings" }));
    const dialog = screen.getByRole("dialog", { name: "Text settings" });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Nested Escape unsaved field" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add condition" }));
    const comparator = within(dialog).getByRole("button", { name: "Comparator: equals" });
    comparator.focus(); fireEvent.click(comparator);
    expect(within(dialog).getByRole("listbox", { name: "Condition comparators" })).toBeInTheDocument();
    expect(fireEvent.keyDown(comparator, { key: "Escape" })).toBe(false);
    expect(screen.getByRole("dialog", { name: "Text settings" })).toBe(dialog);
    await waitFor(() => expect(within(dialog).queryByRole("listbox")).not.toBeInTheDocument());
    expect(comparator).toHaveFocus();
    fireEvent.keyDown(comparator, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Field settings" }));
    expect(within(screen.getByRole("dialog", { name: "Text settings" })).getByLabelText("Label")).toHaveValue("Nested Escape unsaved field");
    expect(actions.saveFormDraftAction).not.toHaveBeenCalled();
    expect(actions.publishFormAction).not.toHaveBeenCalled();
  });

  it.each([768, 1100])("uses the compact editor sheets at %ipx without mounting desktop side panels", async (width) => {
    mockViewport(width);
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    const addField = screen.getByRole("button", { name: "Add field" });
    addField.focus(); fireEvent.click(addField);
    const palette = screen.getByRole("dialog", { name: "Add fields" });
    fireEvent.click(within(palette).getByRole("button", { name: "Text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const settings = screen.getByRole("button", { name: "Field settings" });
    settings.focus(); fireEvent.click(settings);
    const dialog = screen.getByRole("dialog", { name: "Text settings" });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Tablet field" } });
    fireEvent.keyDown(within(dialog).getByLabelText("Label"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(settings).toHaveFocus();
    fireEvent.click(settings);
    expect(within(screen.getByRole("dialog", { name: "Text settings" })).getByLabelText("Label")).toHaveValue("Tablet field");
    expect(actions.saveFormDraftAction).not.toHaveBeenCalled();
  });

  it("retains both desktop side panels above the compact-editor cutoff", () => {
    mockViewport(1101);
    render(<FormBuilder detail={detail()} capabilities={capabilities} services={[service]} />);
    expect(screen.getAllByRole("complementary")).toHaveLength(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    expect(screen.getByText("1 linked service")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Manage"));
    expect(screen.getByRole("button", { name: "Remove SEO Strategy (Intake assignment)" })).toBeInTheDocument();
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
    expect(screen.getByText(/Images and PDFs up to 4 MB/)).toBeInTheDocument();
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
  it("requires an intake recipient from the selected Project company", async () => {
    render(<FormAssignments formId="form" formType="intake" assignments={[]}
      options={[{ id: "project", label: "QA Project", detail: "Acme", companyId: "company" }]}
      recipients={[{ id: "client", label: "Jane Client", detail: "Acme", companyId: "company" }, { id: "foreign", label: "Other Client", detail: "Other", companyId: "other" }]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "QA" } });
    fireEvent.click(await screen.findByRole("option", { name: /QA Project/ }));
    expect(screen.getByRole("button", { name: "Assign Form" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Client recipient" }), { target: { value: "Jane" } });
    fireEvent.click(await screen.findByRole("option", { name: /Jane Client/ }));
    expect(screen.queryByRole("option", { name: /Other Client/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assign Form" }));
    await waitFor(() => expect(actions.assignFormAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.assignFormAction).mock.calls[0]![1].context).toMatchObject({ order_id: "project", client_profile_id: "client" });
  });
  /*
   * The client-facing view of an assignment now lives in the portal's
   * Onboarding surface and is covered by client-portal-dashboard.test.tsx.
   * What remains here is the internal assignment and submission boundary.
   */
  it("assigns Onboarding Forms through the real client boundary", async () => {
    render(<FormAssignments formId="form" formType="onboarding" assignments={[]} options={[{ id: "client", label: "Jane Client", detail: "Acme" }]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Client" }), { target: { value: "Jane" } });
    fireEvent.click(await screen.findByRole("option", { name: /Jane Client/ }));
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
