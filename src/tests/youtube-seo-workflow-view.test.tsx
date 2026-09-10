/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YoutubeSeoWorkflowView } from "../components/operations/youtube-seo-workflow-view";
import type { YoutubeOperationItem, YoutubeStageState } from "../domain/operations/youtube-seo-workflow";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/todo/departments/youtube-seo",
  useSearchParams: () => new URLSearchParams(),
}));

describe("YoutubeSeoWorkflowView", () => {
  it("distinguishes unconfigured and source failure states from a real empty result", () => {
    const { rerender } = render(<YoutubeSeoWorkflowView state="unconfigured" items={[]} sourceTab={null} lastSyncedAt={null} />);
    expect(screen.getByRole("status", { name: "YouTube SEO workflow not connected yet" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    rerender(<YoutubeSeoWorkflowView state="error" items={[]} sourceTab={null} lastSyncedAt={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");

    rerender(<YoutubeSeoWorkflowView state="ready" items={[]} sourceTab="YT SEO September 2026" lastSyncedAt={null} />);
    expect(screen.getByText("No YouTube SEO workflow records were found.")).toBeInTheDocument();
  });

  it("hides the Assigned column and VA filter when no item carries credible assignee data", () => {
    const item = operationItem({ assignedVa: null });
    render(<YoutubeSeoWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt={null} />);
    expect(screen.getByRole("table")).toHaveTextContent("ClientPackageWave VideosYouTubeStatusOutputs");
    expect(screen.queryByRole("button", { name: /^Filter by assigned VA:/ })).not.toBeInTheDocument();
  });

  it("renders the Assigned column, VA filter, stage states, direct outputs, and the workflow inspector when assignee data exists", () => {
    const item = operationItem({ assignedVa: "Rap" });
    render(<YoutubeSeoWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt="2026-09-10T00:00:00.000Z" monthOptions={[{ value: "2026-09", label: "September 2026", tabTitle: item.sourceTab }]} selectedMonth="2026-09" />);

    expect(screen.getByRole("table")).toHaveTextContent("ClientPackageAssignedWave VideosYouTubeStatusOutputs");
    expect(screen.getByRole("button", { name: /^Filter by assigned VA:/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filter by SEO package:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(within(screen.getByRole("dialog", { name: "Filters" })).getByText("Platinum")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: /^Month:/ })).toHaveTextContent("September 2026");

    fireEvent.click(screen.getAllByRole("button", { name: "2 outputs" })[0]!);
    const outputs = screen.getByRole("dialog", { name: "Available outputs" });
    expect(within(outputs).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://docs.google.com/document/d/wave",
      "https://drive.google.com/file/d/upload",
    ]);
    expect(screen.queryByRole("tab", { name: "Workflow" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: "Open client.example" }));
    const inspector = screen.getAllByRole("dialog").find((dialog) => within(dialog).queryByRole("tab", { name: "Workflow" }))!;
    fireEvent.click(within(inspector).getByRole("tab", { name: "Workflow" }));
    expect(within(inspector).getByText("Wave Videos")).toBeInTheDocument();
    expect(within(inspector).getByText("YouTube Upload")).toBeInTheDocument();
    expect(within(inspector).getByText("no blog post link")).toBeInTheDocument();
  });
});

function operationItem(overrides: { assignedVa: string | null }): YoutubeOperationItem {
  return {
    id: "youtube-1",
    sourceTab: "YT SEO September 2026",
    sourceSection: "YouTube SEO",
    client: "https://client.example",
    clientUrl: "https://client.example",
    email: "client@example.com",
    loginUrl: "https://docs.google.com/document/d/login",
    orderNumber: "WF-1",
    seoPackage: "Platinum",
    primaryKeyword: "junk removal",
    city: "Austin",
    promptSopUrl: "https://docs.google.com/document/d/sop",
    assignedVa: overrides.assignedVa,
    notes: "no blog post link",
    waveStage: stage("wave", "Wave Videos", "completed", "https://docs.google.com/document/d/wave"),
    youtubeStage: stage("youtube", "YouTube Upload", "in_progress", "https://drive.google.com/file/d/upload"),
    normalizedStatus: "in_progress",
  };
}

function stage(key: "wave" | "youtube", label: "Wave Videos" | "YouTube Upload", state: YoutubeStageState, outputUrl: string) {
  return { key, label, sourceLabel: label, state, rawStatus: state, output: outputUrl, outputUrl };
}
