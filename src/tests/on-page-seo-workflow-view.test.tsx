/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnPageSeoWorkflowView } from "../components/operations/on-page-seo-workflow-view";
import type { OnPageSeoOperationItem } from "../domain/operations/on-page-seo-workflow";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/todo/departments/on-page-seo",
  useSearchParams: () => new URLSearchParams(),
}));

describe("OnPageSeoWorkflowView", () => {
  it("renders an honest source-ready workspace without fabricated operations data", () => {
    const { container } = render(<OnPageSeoWorkflowView state="unconfigured" items={[]} sourceTab={null} lastSyncedAt={null} />);

    expect(screen.getByRole("heading", { name: "On-page SEO", level: 2 })).toBeInTheDocument();
    const status = screen.getByRole("status", { name: "On-page SEO workflow not connected yet" });
    expect(status).toHaveTextContent("approved source is connected");
    expect(within(status).getByText("Workspace")).toBeInTheDocument();
    expect(within(status).getByText("Ready")).toBeInTheDocument();
    expect(within(status).getByText("Workflow source")).toBeInTheDocument();
    expect(within(status).getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /0 records|client|page count|keyword count|assignee|due date|SEO score|credential|environment|API|database/i,
    );
  });

  it("renders the compact worklist, real filters, and deliverables inspector", () => {
    const item: OnPageSeoOperationItem = {
      id: "1",
      sourceTab: "OnPage September 2026",
      sourceSection: "On-page SEO",
      client: "https://client.example/wp-admin",
      clientUrl: "https://client.example/wp-admin",
      email: "client@example.com",
      loginUrl: "https://docs.example/login",
      assignedVa: "Geraldine",
      assignmentSourceValue: "Geraldine",
      owner: null,
      orderNumber: "WF-1",
      seoPackage: "Platinum",
      primaryKeyword: "Junk removal",
      city: "Austin",
      promptSopUrl: null,
      deliverables: [
        { key: "audit", label: "On-page Audit", state: "completed", rawStatus: "Done", output: "https://docs.example/audit", outputUrl: "https://docs.example/audit" },
        { key: "schema", label: "Schema", state: "not_started", rawStatus: null, output: null, outputUrl: null },
      ],
      completedDeliverables: 1,
      applicableDeliverables: 2,
      normalizedStatus: "in_progress",
    };
    render(<OnPageSeoWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt="2026-09-10T00:00:00.000Z" monthOptions={[{ value: "2026-09", label: "September 2026", tabTitle: item.sourceTab }]} selectedMonth="2026-09" />);

    expect(screen.getByRole("table")).toHaveTextContent("ClientPackageAssignedProgressStatusOutputs");
    expect(screen.getByRole("row", { name: "Open client.example" })).toHaveTextContent("1 / 2");
    expect(screen.getByRole("button", { name: /^Filter by assigned VA:/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filter by SEO package:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(within(screen.getByRole("dialog", { name: "Filters" })).getByText("Platinum")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: /^Month:/ })).toHaveTextContent("September 2026");

    fireEvent.click(screen.getByRole("row", { name: "Open client.example" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("tab", { name: "Deliverables" }));
    expect(within(screen.getByRole("dialog")).getByText("On-page Audit")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: /^Open$/ })).toHaveAttribute("href", "https://docs.example/audit");
  });

  it("exposes zero, one, and multiple real outputs without opening the row inspector", () => {
    const items = [
      outputItem("completed", "completed.example", "completed", [
        ["Audit", "https://docs.google.com/document/d/audit"],
        ["Blog Posted", "https://drive.google.com/file/d/blog"],
        ["Schema", "https://docs.google.com/document/d/schema"],
      ]),
      outputItem("progress", "progress.example", "in_progress", [
        ["Podcast Embed", "https://docs.google.com/document/d/podcast"],
        ["YouTube Embed", "https://drive.google.com/file/d/youtube"],
        ["Location Page", "https://docs.google.com/document/d/location"],
        ["Keyword Research", "https://docs.google.com/document/d/keywords"],
      ]),
      outputItem("single", "single.example", "in_progress", [["Optimization", "https://docs.google.com/document/d/optimization"]]),
      outputItem("none", "none.example", "not_started", []),
    ];

    render(<OnPageSeoWorkflowView state="ready" items={items} sourceTab="OnPage September 2026" lastSyncedAt={null} />);

    const threeOutputs = screen.getAllByRole("button", { name: "3 outputs" })[0]!;
    const mobileRowButton = screen.getByRole("button", { name: "Open completed.example" });
    const mobileOutputsButton = screen.getAllByRole("button", { name: "3 outputs" }).find((button) => button.closest(".dept-mobile-list"))!;
    expect(mobileRowButton).not.toContainElement(mobileOutputsButton);
    expect(mobileRowButton.parentElement).toContainElement(mobileOutputsButton);
    fireEvent.click(threeOutputs);
    expect(screen.queryByRole("tab", { name: "Deliverables" })).not.toBeInTheDocument();

    const outputsDialog = screen.getByRole("dialog", { name: "Available outputs" });
    expect(within(outputsDialog).getByText("Audit")).toBeInTheDocument();
    expect(within(outputsDialog).getByText("Blog Posted")).toBeInTheDocument();
    expect(within(outputsDialog).getByText("Schema")).toBeInTheDocument();
    expect(within(outputsDialog).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://docs.google.com/document/d/audit",
      "https://drive.google.com/file/d/blog",
      "https://docs.google.com/document/d/schema",
    ]);

    fireEvent.click(within(outputsDialog).getAllByRole("link")[0]!);
    expect(screen.queryByRole("tab", { name: "Deliverables" })).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "4 outputs" })).toHaveLength(2);
    const singleLinks = screen.getAllByRole("link", { name: "Open output" });
    expect(singleLinks).toHaveLength(2);
    expect(singleLinks[0]).toHaveAttribute("href", "https://docs.google.com/document/d/optimization");
    fireEvent.click(singleLinks[0]!);
    expect(screen.queryByRole("tab", { name: "Deliverables" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Not available")).toHaveLength(2);

    fireEvent.click(screen.getByRole("row", { name: "Open completed.example" }));
    expect(screen.getByRole("tab", { name: "Deliverables" })).toBeInTheDocument();
  });
});

function outputItem(
  id: string,
  client: string,
  normalizedStatus: OnPageSeoOperationItem["normalizedStatus"],
  outputs: readonly (readonly [label: string, url: string])[],
): OnPageSeoOperationItem {
  return {
    id,
    sourceTab: "OnPage September 2026",
    sourceSection: "On-page SEO",
    client,
    clientUrl: null,
    email: null,
    loginUrl: null,
    assignedVa: "Geraldine",
    assignmentSourceValue: "Geraldine",
    owner: null,
    orderNumber: null,
    seoPackage: "Platinum",
    primaryKeyword: null,
    city: null,
    promptSopUrl: null,
    deliverables: outputs.map(([label, url], index) => ({
      key: `deliverable-${index}`,
      label,
      state: normalizedStatus === "completed" ? "completed" : "in_progress",
      rawStatus: normalizedStatus === "completed" ? "Completed" : "In Progress",
      output: url,
      outputUrl: url,
    })),
    completedDeliverables: normalizedStatus === "completed" ? outputs.length : 0,
    applicableDeliverables: Math.max(outputs.length, 1),
    normalizedStatus,
  };
}
