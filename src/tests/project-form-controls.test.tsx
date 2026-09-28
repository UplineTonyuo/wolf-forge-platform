/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyRow, ServiceFolderRow, ServiceRow } from "../lib/supabase/database-rows";
import type { ServiceAssigneeOption } from "../repositories/service-repository";

const { create, update } = vi.hoisted(() => ({
  create: vi.fn(async (state: unknown, formData: FormData) => {
    void state;
    void formData;
    return { error: null, fieldErrors: {} };
  }),
  update: vi.fn(),
}));

vi.mock("../app/actions/orders", () => ({
  createProjectAction: create,
  updateProjectAction: update,
}));

const { ProjectForm } = await import("../components/projects/project-form");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const clientId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const folderId = "33333333-3333-4333-8333-333333333333";
const teammateId = "44444444-4444-4444-8444-444444444444";
const otherTeammateId = "55555555-5555-4555-8555-555555555555";

const clients = [{ id: clientId, name: "Acme" } as CompanyRow];
const folders = [{ id: folderId, name: "SEO", archived_at: null } as ServiceFolderRow];
const services = [
  { id: serviceId, name: "SEO Strategy", folder_id: folderId, is_active: true } as ServiceRow,
];
const assignees: ServiceAssigneeOption[] = [
  { id: teammateId, displayName: "QA Local" },
  { id: otherTeammateId, displayName: "WF William" },
];

function renderForm() {
  return render(
    <ProjectForm
      mode="create"
      clients={clients}
      services={services}
      folders={folders}
      assignees={assignees}
      canAssign
    />,
  );
}

/** A day that is always in the calendar month the picker opens on. */
function dayInCurrentMonth() {
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), 15);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  return { iso, label };
}

describe("Create Project custom controls", () => {
  it("renders Wolf Forge controls instead of native browser controls", () => {
    const { container } = renderForm();

    expect(container.querySelectorAll('select, input[type="date"]')).toHaveLength(0);
    expect(screen.queryByRole("combobox", { name: "Priority" })).toBeNull();
    expect(screen.getByRole("button", { name: "Priority: Normal" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assigned teammate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Due date: Select a date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start date: Select a date" })).toBeInTheDocument();
  });

  it("persists the selected priority through the submitted form data", async () => {
    const { container } = renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Priority: Normal" }));
    fireEvent.click(await screen.findByRole("option", { name: "High" }));

    expect(container.querySelector('input[name="priority"]')).toHaveValue("high");
    expect(screen.getByRole("button", { name: "Priority: High" })).toBeInTheDocument();
  });

  it("keeps Unassigned selectable and persists the chosen teammate id", async () => {
    const { container } = renderForm();
    const combobox = screen.getByRole("combobox", { name: "Assigned teammate" });
    const hidden = container.querySelector('input[name="assigned_to_profile_id"]');

    expect(hidden).toHaveValue("");
    expect(combobox).toHaveValue("Unassigned");

    fireEvent.click(combobox);
    fireEvent.click(await screen.findByRole("option", { name: "WF William" }));
    expect(hidden).toHaveValue(otherTeammateId);
    expect(combobox).toHaveValue("WF William");

    /* Typing clears the selection and filters, so Unassigned stays reachable. */
    fireEvent.change(combobox, { target: { value: "Un" } });
    fireEvent.click(await screen.findByRole("option", { name: "Unassigned" }));
    expect(hidden).toHaveValue("");
    expect(combobox).toHaveValue("Unassigned");
  });

  it("persists the picked due and start dates, and clears them", async () => {
    const { container } = renderForm();
    const due = dayInCurrentMonth();

    fireEvent.click(screen.getByRole("button", { name: "Due date: Select a date" }));
    fireEvent.click(await screen.findByRole("button", { name: due.label }));
    expect(container.querySelector('input[name="due_at"]')).toHaveValue(due.iso);

    const start = dayInCurrentMonth();
    fireEvent.click(screen.getByRole("button", { name: "Start date: Select a date" }));
    fireEvent.click(await screen.findByRole("button", { name: start.label }));
    expect(container.querySelector('input[name="started_at"]')).toHaveValue(start.iso);

    /* Clear is offered and empties the value, preserving the optional field. */
    fireEvent.click(screen.getByRole("button", { name: /^Due date:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    expect(container.querySelector('input[name="due_at"]')).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /^Start date:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    expect(container.querySelector('input[name="started_at"]')).toHaveValue("");
  });

  it("submits the custom control values through the real project action contract", async () => {
    const { container } = renderForm();
    const due = dayInCurrentMonth();

    fireEvent.click(screen.getByRole("button", { name: "Priority: Normal" }));
    fireEvent.click(await screen.findByRole("option", { name: "Urgent" }));

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned teammate" }));
    fireEvent.click(await screen.findByRole("option", { name: "QA Local" }));

    fireEvent.click(screen.getByRole("button", { name: "Due date: Select a date" }));
    fireEvent.click(await screen.findByRole("button", { name: due.label }));

    const form = container.querySelector("form")!;
    const submitted = new FormData(form);
    expect(submitted.get("priority")).toBe("urgent");
    expect(submitted.get("assigned_to_profile_id")).toBe(teammateId);
    expect(submitted.get("due_at")).toBe(due.iso);

    fireEvent.submit(form);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const actionFormData = create.mock.calls[0]![1] as FormData;
    expect(actionFormData.get("priority")).toBe("urgent");
    expect(actionFormData.get("assigned_to_profile_id")).toBe(teammateId);
    expect(actionFormData.get("due_at")).toBe(due.iso);
  });
});
