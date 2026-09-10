/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OffPageSeoWorkflowView } from "../components/operations/off-page-seo-workflow-view";
import type { OffPageOperationItem } from "../domain/operations/off-page-seo-workflow";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/todo/departments/off-page-seo",
  useSearchParams: () => new URLSearchParams(),
}));

function baseItem(overrides: Partial<OffPageOperationItem>): OffPageOperationItem {
  return {
    id: "1",
    sourceTab: "OFF PAGE SEO SEPTEMBER 2026",
    sourceSection: "Off-page SEO",
    sourceRow: 3,
    client: "https://client.example/",
    clientUrl: "https://client.example/",
    email: "client@example.com",
    loginUrl: null,
    orderNumber: "WF-1",
    seoPackage: "Platinum",
    primaryKeyword: "Junk removal",
    city: "Austin",
    deliverables: [],
    completedDeliverables: 0,
    applicableDeliverables: 0,
    normalizedStatus: "not_started",
    attention: null,
    ...overrides,
  };
}

describe("OffPageSeoWorkflowView", () => {
  it("renders an honest source-ready workspace without fabricated operations data", () => {
    const { container } = render(<OffPageSeoWorkflowView state="unconfigured" items={[]} sourceTab={null} lastSyncedAt={null} />);

    expect(screen.getByRole("heading", { name: "Off-page SEO", level: 2 })).toBeInTheDocument();
    const status = screen.getByRole("status", { name: "Off-page SEO workflow not connected yet" });
    expect(status).toHaveTextContent("approved source is connected");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0 records|assignee|due date|SEO score|credential|environment|API|database/i);
  });

  it("renders the compact worklist with Progress and Attention, and groups deliverables in the inspector", () => {
    const item = baseItem({
      normalizedStatus: "stuck",
      attention: "Cloudstack stuck",
      completedDeliverables: 3,
      applicableDeliverables: 6,
      deliverables: [
        { key: "press-release", label: "4 Press Releases", state: "completed", rawStatus: "Done", output: "https://docs.example/pr", outputUrl: "https://docs.example/pr" },
        { key: "directory-listings", label: "100 Directory Listings", state: "completed", rawStatus: "Done", output: null, outputUrl: null },
        { key: "citations", label: "100 Citations", state: "completed", rawStatus: "Done", output: null, outputUrl: null },
        { key: "cloudstack", label: "Cloudstack", state: "stuck", rawStatus: "Stuck", output: "need log.ins", outputUrl: null },
        { key: "advance-gstack", label: "Advance Gstack", state: "not_started", rawStatus: null, output: null, outputUrl: null },
        { key: "geo-prominence", label: "Geo Prominence Boosters", state: "not_started", rawStatus: null, output: "NO", outputUrl: null },
      ],
    });
    render(<OffPageSeoWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt="2026-09-10T00:00:00.000Z" monthOptions={[{ value: "2026-09", label: "September 2026", tabTitle: item.sourceTab }]} selectedMonth="2026-09" />);

    expect(screen.getByRole("table")).toHaveTextContent("ClientPackageProgressStatusAttentionOutputs");
    expect(screen.queryByRole("button", { name: /^Filter by assigned VA:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filter by SEO package:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(within(screen.getByRole("dialog", { name: "Filters" })).getByText("Platinum")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    const row = screen.getByRole("row", { name: "Open client.example" });
    expect(row).toHaveTextContent("3 / 6");
    expect(row).toHaveTextContent("Cloudstack stuck");

    fireEvent.click(row);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Off-page Work" }));
    expect(within(dialog).getByText("Foundational / Promotion")).toBeInTheDocument();
    expect(within(dialog).getByText("Authority / Stack Work")).toBeInTheDocument();
    expect(within(dialog).getByText("Other Work")).toBeInTheDocument();
    expect(within(dialog).getByText("4 Press Releases")).toBeInTheDocument();
    expect(within(dialog).getByText("need log.ins")).toBeInTheDocument();
    expect(within(dialog).getByText("Geo Prominence Boosters")).toBeInTheDocument();
    expect(within(dialog).getByText("NO")).toBeInTheDocument();
  });

  it("has no attention column value and no fake blocker text for a healthy client", () => {
    const item = baseItem({
      normalizedStatus: "completed",
      attention: null,
      completedDeliverables: 2,
      applicableDeliverables: 2,
      deliverables: [
        { key: "citations", label: "100 Citations", state: "completed", rawStatus: "Done", output: null, outputUrl: null },
        { key: "directory-listings", label: "100 Directory Listings", state: "completed", rawStatus: "Done", output: null, outputUrl: null },
      ],
    });
    render(<OffPageSeoWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt={null} />);
    const row = screen.getByRole("row", { name: "Open client.example" });
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("exposes quick Outputs without opening the row inspector, including the Onboarding / Access Sheet link", () => {
    const item = baseItem({
      loginUrl: "https://drive.google.com/file/d/onboarding",
      deliverables: [
        { key: "cloudstack", label: "Cloudstack", state: "completed", rawStatus: "Done", output: "https://drive.google.com/x", outputUrl: "https://drive.google.com/x" },
        { key: "citations", label: "100 Citations", state: "completed", rawStatus: "Done", output: "https://drive.google.com/y", outputUrl: "https://drive.google.com/y" },
      ],
      completedDeliverables: 2,
      applicableDeliverables: 2,
      normalizedStatus: "completed",
    });
    render(<OffPageSeoWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt={null} />);

    const outputsButton = screen.getAllByRole("button", { name: "3 outputs" })[0]!;
    fireEvent.click(outputsButton);
    expect(screen.queryByRole("tab", { name: "Off-page Work" })).not.toBeInTheDocument();
    const outputsDialog = screen.getByRole("dialog", { name: "Available outputs" });
    expect(within(outputsDialog).getByText("Onboarding / Access Sheet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: "Open client.example" }));
    expect(screen.getByRole("tab", { name: "Off-page Work" })).toBeInTheDocument();
  });
});

describe("Off-page toolbar status dropdown", () => {
  it("defaults to all, counts source rows, combines filters, and resets on a month change", async () => {
    const items = [
      baseItem({ id: "a", client: "Alpha", clientUrl: null, normalizedStatus: "in_progress" }),
      baseItem({ id: "b", client: "Beta", clientUrl: null, normalizedStatus: "in_progress", seoPackage: "Gold" }),
      baseItem({ id: "c", client: "Gamma", clientUrl: null, normalizedStatus: "stuck" }),
      baseItem({ id: "d", client: "Delta", clientUrl: null, normalizedStatus: "cancelled" }),
    ];
    const props = { state: "ready" as const, items, sourceTab: "August", lastSyncedAt: null };
    const { container, rerender } = render(<OffPageSeoWorkflowView {...props} />);
    const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const choose = (label: string, option: RegExp) => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
      fireEvent.click(screen.getByRole("option", { name: option }));
    };
    const choosePackage = (label: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Filters" }));
      fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: label }));
    };
    expect(container.querySelector(".dept-status-filter")).toBeNull();
    expect(screen.getByRole("button", { name: "Filter by status: All Statuses" })).toBeInTheDocument();
    expect(rows()).toHaveLength(4);
    choose("Filter by status", /In Progress.*2/);
    expect(rows()).toHaveLength(2);
    choosePackage("Platinum");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    choose("Filter by status", /Stuck.*1/);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Gamma");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    choose("Filter by status", /Cancelled.*1/);
    expect(rows()[0]).toHaveTextContent("Delta");
    // Source changes follow the existing reset contract, including an active inspector.
    fireEvent.click(rows()[0]!);
    rerender(<OffPageSeoWorkflowView {...props} sourceTab="July" />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Filter by status: All Statuses" })).toBeInTheDocument();
    expect(rows()).toHaveLength(4);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Beta" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Beta");
  });
});
