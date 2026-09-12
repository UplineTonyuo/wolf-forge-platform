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
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Content workflow not connected yet");
    expect(within(status).getByText("Workspace")).toBeInTheDocument();
    expect(within(status).getByText("Ready")).toBeInTheDocument();
    expect(within(status).getByText("Workflow source")).toBeInTheDocument();
    expect(within(status).getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("0 records")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/CONTENT_WORKFLOW_SPREADSHEET_ID|service account|credential|Vercel/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to all departments" })).toHaveAttribute(
      "href",
      "/todo/departments",
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Filter by status: All Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: /Stuck.*1/ }));
    expect(within(screen.getByRole("table")).getByText("zebra.example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Filter by status:/ }));
    fireEvent.click(screen.getByRole("option", { name: /All Statuses.*2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Starter" }));
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

  it("gives the mobile card direct Blog Content access without opening the inspector", () => {
    renderReady();
    const list = screen.getByRole("list");
    const link = within(list).getByRole("link", { name: "Open content" });
    expect(link).toHaveAttribute("href", "https://docs.example.com/zebra-content");
    fireEvent.click(link);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clamps long Website/Package/Content Target values to a single line in the table, never growing the row", () => {
    const longItem: ContentOperationItem = {
      id: "3",
      sourceTab: "CONTENT AUGUST 2026",
      sourceSection: "Content",
      website: "https://really-long-client-domain-name-example.com/path",
      email: null,
      loginUrl: null,
      orderNumber: "WF-99",
      seoPackage: "Platinum SEO Success Blueprint (100 Targeted Keywords)",
      primaryKeyword: "wood floor installation service, hardwood floor installation",
      city: "Firestone",
      promptSopUrl: null,
      blogContent: null,
      normalizedStatus: "in_progress",
      rawStatus: "In Progress",
    };
    renderReady([longItem]);
    const row = screen.getByRole("row", { name: /really-long-client-domain-name-example\.com/ });
    for (const longText of [
      "really-long-client-domain-name-example.com",
      "Platinum SEO Success Blueprint (100 Targeted Keywords)",
      "wood floor installation service, hardwood floor installation · Firestone",
    ]) {
      const span = within(row).getByText(longText);
      expect(span.style.overflow).toBe("hidden");
      expect(span.style.textOverflow).toBe("ellipsis");
      expect(span.style.whiteSpace).toBe("nowrap");
    }
    // The full untruncated package value stays reachable through the cell's own title.
    expect(row.querySelector('td[title="Platinum SEO Success Blueprint (100 Targeted Keywords)"]')).toBeInTheDocument();
  });
});
