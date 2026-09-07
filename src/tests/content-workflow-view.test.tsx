/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContentWorkflowView } from "../components/operations/content-workflow-view";
import type { ContentOperationItem } from "../domain/operations/content-workflow";

afterEach(cleanup);

const ITEMS: ContentOperationItem[] = [
  {
    id: "2",
    sourceTab: "CONTENT AUGUST 2026",
    sourceSection: "Content",
    website: "https://zebra.example.com/wp-admin",
    email: "zebra@example.com",
    loginUrl: "https://docs.example.com/zebra-logins",
    orderNumber: "WF-20",
    seoPackage: "Growth",
    primaryKeyword: "roof repair",
    city: "Denver",
    promptSopUrl: "https://docs.example.com/zebra-sop",
    blogContent: "https://docs.example.com/zebra-content",
    normalizedStatus: "stuck",
    rawStatus: "Blocked",
  },
  {
    id: "1",
    sourceTab: "CONTENT AUGUST 2026",
    sourceSection: "Content",
    website: "https://alpha.example.com",
    email: null,
    loginUrl: null,
    orderNumber: "WF-3",
    seoPackage: "Starter",
    primaryKeyword: "plumber near me",
    city: "Austin",
    promptSopUrl: null,
    blogContent: "Draft set received",
    normalizedStatus: "completed",
    rawStatus: "Published",
  },
];

function renderReady(items = ITEMS) {
  return render(
    <ContentWorkflowView
      state="ready"
      items={items}
      sourceTab="CONTENT AUGUST 2026"
      lastSyncedAt="2026-08-31T12:00:00.000Z"
    />,
  );
}

function chooseControl(label: string, option: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("ContentWorkflowView states", () => {
  it("shows a polished unconfigured state without technical setup details", () => {
    const { container } = render(
      <ContentWorkflowView state="unconfigured" items={[]} sourceTab={null} lastSyncedAt={null} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Content workflow is not connected yet.");
    expect(container.textContent).not.toMatch(/CONTENT_WORKFLOW_SPREADSHEET_ID|service account|credential|Vercel/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps source failures distinct from missing configuration", () => {
    render(<ContentWorkflowView state="error" items={[]} sourceTab={null} lastSyncedAt={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Content workflow is temporarily unavailable.");
    expect(screen.queryByText(/not connected yet/i)).not.toBeInTheDocument();
  });

  it("shows an honest empty state without fabricated rows", () => {
    renderReady([]);
    expect(screen.getByRole("status")).toHaveTextContent("No Content workflow records were found.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ContentWorkflowView local worklist behavior", () => {
  it("searches across Content-specific fields and filters by status/package", () => {
    renderReady();
    fireEvent.change(screen.getByLabelText("Search Content work"), { target: { value: "Austin" } });
    expect(within(screen.getByRole("table")).getByText("alpha.example.com")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("zebra.example.com")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(screen.getByRole("button", { name: /Stuck 1/ }));
    expect(within(screen.getByRole("table")).getByText("zebra.example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /All 2/ }));
    chooseControl("Filter by SEO package", "Starter");
    expect(within(screen.getByRole("table")).getByText("alpha.example.com")).toBeInTheDocument();
  });

  it("sorts without mutating the source order", () => {
    renderReady();
    chooseControl("Sort Content work", "Website A–Z");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getAllByRole("cell")[0]).toHaveTextContent("alpha.example.com");
    expect(ITEMS[0]?.website).toContain("zebra");
  });

  it("opens the shared inspector with Content-specific fields and safe resources", () => {
    renderReady();
    fireEvent.click(screen.getByRole("row", { name: /zebra\.example\.com/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("zebra@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("WF-20")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Resources" }));
    expect(within(dialog).getByText("Login document")).toBeInTheDocument();
    expect(within(dialog).getByText("Prompt / SOP")).toBeInTheDocument();
    expect(within(dialog).getByText("4 Blog Content")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open content" })).toHaveAttribute(
      "href",
      "https://docs.example.com/zebra-content",
    );

    fireEvent.click(within(dialog).getByRole("tab", { name: "Source" }));
    expect(within(dialog).getByText("Read only")).toBeInTheDocument();
    expect(within(dialog).getAllByText("CONTENT AUGUST 2026").length).toBeGreaterThan(0);
  });

  it("renders the responsive mobile representation from the same records", () => {
    renderReady();
    const list = screen.getByRole("list");
    expect(within(list).getByText("alpha.example.com")).toBeInTheDocument();
    expect(within(list).getAllByRole("button")).toHaveLength(2);
  });
});
