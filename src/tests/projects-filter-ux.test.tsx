/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../app/actions/orders", () => ({
  bulkChangeProjectStatusAction: vi.fn(),
  bulkAssignProjectsAction: vi.fn(),
  bulkArchiveProjectsAction: vi.fn(),
}));

const { composeProjectRows } = await import("../domain/orders/projections");
const { ProjectsWorkspace } = await import("../components/projects/projects-workspace");

type RelationRow = Parameters<typeof composeProjectRows>[0][number];

const now = new Date("2026-09-16T12:00:00.000Z");
const anthony = "a0000000-0000-4000-8000-000000000001";

const seoSprintId = "50000000-0000-4000-8000-000000000001";
const mapsSprintId = "50000000-0000-4000-8000-000000000002";
const webBuildId = "50000000-0000-4000-8000-000000000003";

function order(id: string, overrides: Partial<RelationRow>): RelationRow {
  return {
    id,
    order_number: 100,
    company_id: "c0000000-0000-4000-8000-000000000001",
    service_id: seoSprintId,
    assigned_to_profile_id: null,
    title: "Untitled",
    status: "pending",
    priority: "normal",
    due_at: null,
    started_at: null,
    completed_at: null,
    notes: null,
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T09:00:00.000Z",
    archived_at: null,
    companies: { id: "c0000000-0000-4000-8000-000000000001", name: "Kraken Junk Removal" },
    services: { id: seoSprintId, name: "SEO Sprint" },
    profiles: null,
    ...overrides,
  } as RelationRow;
}

const rows = composeProjectRows(
  [
    order("10000000-0000-4000-8000-000000000001", {
      order_number: 101,
      title: "Local SEO Growth Campaign",
      assigned_to_profile_id: anthony,
      profiles: { id: anthony, display_name: "Anthony Paghubasan", avatar_url: null },
      service_id: seoSprintId,
      services: { id: seoSprintId, name: "SEO Sprint" },
    }),
    order("10000000-0000-4000-8000-000000000002", {
      order_number: 102,
      title: "Foundation Build",
      status: "waiting_reply",
      company_id: "c0000000-0000-4000-8000-000000000002",
      companies: { id: "c0000000-0000-4000-8000-000000000002", name: "Junk Buddies" },
      service_id: webBuildId,
      services: { id: webBuildId, name: "Website Build" },
    }),
    order("10000000-0000-4000-8000-000000000003", {
      order_number: 103,
      title: "Maps Ranking Campaign",
      service_id: mapsSprintId,
      services: { id: mapsSprintId, name: "Maps Sprint" },
    }),
  ],
  [],
  now,
);

const capabilities = { create: true, edit: true, assign: true, archive: true };

const serviceFolders = [
  {
    id: "seo",
    name: "SEO Sprints",
    description: null,
    image_url: null,
    parent_id: null,
    sort_order: 1,
    archived_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: "web",
    name: "Website Design",
    description: null,
    image_url: null,
    parent_id: null,
    sort_order: 2,
    archived_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

const services = [
  { id: seoSprintId, name: "SEO Sprint", folder_id: "seo" },
  { id: mapsSprintId, name: "Maps Sprint", folder_id: "seo" },
  { id: webBuildId, name: "Website Build", folder_id: "web" },
];

const qaLocalId = "a0000000-0000-4000-8000-000000000002";
const people = [
  { id: anthony, name: "Anthony Paghubasan" },
  { id: qaLocalId, name: "QA Local", avatarUrl: "https://cdn.example.com/qa-local.jpg" },
];
const clients = [
  { id: "c0000000-0000-4000-8000-000000000001", name: "Kraken Junk Removal" },
  { id: "c0000000-0000-4000-8000-000000000002", name: "Junk Buddies" },
];

function renderWorkspace() {
  return render(
    <ProjectsWorkspace
      rows={rows}
      complete
      people={people}
      services={services}
      serviceFolders={serviceFolders}
      clients={clients}
      capabilities={capabilities}
    />,
  );
}

function rowCount() {
  return screen.getAllByRole("button", { name: /^Select .* project /u }).length;
}

function stubViewport(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => media);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Mobile Filters sheet (<=767px)", () => {
  beforeEach(() => stubViewport(true));

  it("keeps project search permanently visible outside the Filter sheet", () => {
    renderWorkspace();

    expect(screen.getByRole("searchbox", { name: "Search projects" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a modal sheet (not the inline panel) when Filter is tapped, with no native selects", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Filters" })).toBeTruthy();
    expect(document.querySelector("select")).toBeNull();
  });

  it("closes the sheet from the close button", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Person selector is a searchable option list, not a native select, and filters projects", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Person/u }));

    const dialog = screen.getByRole("dialog");
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Anthony Paghubasan/u }));

    // Selecting returns to the Filters menu automatically.
    expect(within(dialog).getByRole("heading", { name: "Filters" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Apply filters/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Local SEO Growth Campaign")).toBeTruthy();
  });

  it("Client selector is a searchable option list, not a native select, and filters projects", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Client/u }));

    const dialog = screen.getByRole("dialog");
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Junk Buddies/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Apply filters/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Foundation Build")).toBeTruthy();
  });

  it("Status selector is a plain option list, not a native select, and filters projects", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Status/u }));

    const dialog = screen.getByRole("dialog");
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Waiting on client/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Apply filters/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Foundation Build")).toBeTruthy();
  });

  it("Service opens the folder list first, then that folder's services", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Service/u }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("SEO Sprints")).toBeTruthy();
    expect(within(dialog).getByText("Website Design")).toBeTruthy();
    expect(within(dialog).queryByText("Maps Sprint")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: /SEO Sprints/u }));

    expect(within(dialog).getByText("SEO Sprint")).toBeTruthy();
    expect(within(dialog).getByText("Maps Sprint")).toBeTruthy();
    expect(within(dialog).queryByText("Website Build")).toBeNull();
  });

  it("searches within the selected folder only", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Service/u }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /SEO Sprints/u }));

    fireEvent.change(within(dialog).getByPlaceholderText("Search SEO Sprints services..."), {
      target: { value: "maps" },
    });

    expect(within(dialog).getByText("Maps Sprint")).toBeTruthy();
    expect(within(dialog).queryByText("SEO Sprint")).toBeNull();
  });

  it("Change folder returns to the folder list", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Service/u }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /SEO Sprints/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Change folder/u }));

    expect(within(dialog).getByText("SEO Sprints")).toBeTruthy();
    expect(within(dialog).getByText("Website Design")).toBeTruthy();
  });

  it("selecting a service applies it and filters projects", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Service/u }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /SEO Sprints/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Maps Sprint/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Apply filters/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Maps Ranking Campaign")).toBeTruthy();
  });

  it("Clear filters resets every filter, including Status, back to its default", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Status/u }));

    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Waiting on client/u }));
    expect(rowCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /^Client/u }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Junk Buddies/u }));
    expect(rowCount()).toBe(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear filters" }));
    expect(rowCount()).toBe(3);
  });
});

describe("Desktop Service filter (>767px)", () => {
  beforeEach(() => stubViewport(false));

  it("keeps the approved inline filter row, with Search/Person/Client/Status as before", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    expect(screen.getByLabelText("Search")).toBeTruthy();
    expect(screen.getByLabelText("Person")).toBeTruthy();
    expect(screen.getByLabelText("Client")).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });

  it("replaces the Person <select> with a searchable option list", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    const trigger = screen.getByLabelText("Person");
    expect(trigger.tagName).toBe("BUTTON");

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Choose a person" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Anthony Paghubasan/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Local SEO Growth Campaign")).toBeTruthy();
    expect(within(screen.getByLabelText("Person")).getByText("Anthony Paghubasan")).toBeTruthy();
  });

  it("shows real profile identity for people: a photo when one exists, initials otherwise", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.click(screen.getByLabelText("Person"));

    const dialog = screen.getByRole("dialog", { name: "Choose a person" });
    const qaRow = within(dialog).getByRole("button", { name: /QA Local/u });
    const qaImage = qaRow.querySelector("img");
    expect(qaImage?.getAttribute("src")).toBe("https://cdn.example.com/qa-local.jpg");

    const anthonyRow = within(dialog).getByRole("button", { name: /Anthony Paghubasan/u });
    expect(anthonyRow.querySelector("img")).toBeNull();
    expect(within(anthonyRow).getByText("AP")).toBeTruthy();
  });

  it("replaces the Client <select> with a searchable option list", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    const trigger = screen.getByLabelText("Client");
    expect(trigger.tagName).toBe("BUTTON");

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Choose a client" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Junk Buddies/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Foundation Build")).toBeTruthy();
  });

  it("adds a Status field, wired to the same status used by the status tabs, with no native select", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    const trigger = screen.getByLabelText("Status");
    expect(trigger.tagName).toBe("BUTTON");
    expect(within(trigger).getByText("All statuses")).toBeTruthy();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Choose a status" });
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Waiting on client/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Foundation Build")).toBeTruthy();
    expect(within(screen.getByLabelText("Status")).getByText("Waiting on client")).toBeTruthy();
  });

  it("replaces the flat Service <select> with the folder -> service chooser", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    const trigger = screen.getByLabelText("Service");
    expect(trigger.tagName).toBe("BUTTON");
    expect(within(trigger).getByText("All services")).toBeTruthy();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Choose a service" });
    expect(within(dialog).getByText("SEO Sprints")).toBeTruthy();
    expect(within(dialog).getByText("Website Design")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /SEO Sprints/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Maps Sprint/u }));

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Maps Ranking Campaign")).toBeTruthy();
    expect(within(screen.getByLabelText("Service")).getByText("Maps Sprint")).toBeTruthy();
  });

  it("Change folder returns to the folder list on desktop too", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    const trigger = screen.getByLabelText("Service");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Choose a service" });
    fireEvent.click(within(dialog).getByRole("button", { name: /SEO Sprints/u }));

    fireEvent.click(within(dialog).getByRole("button", { name: /Change folder/u }));
    expect(within(dialog).getByText("SEO Sprints")).toBeTruthy();
    expect(within(dialog).getByText("Website Design")).toBeTruthy();
  });
});
