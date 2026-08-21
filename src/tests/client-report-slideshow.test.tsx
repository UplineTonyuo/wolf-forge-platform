/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ReportSlide } from "../domain/reporting/slideshow";

vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode; [key: string]: unknown }) => (
    <a {...props} />
  ),
}));

const { ClientReportSlideshow } = await import(
  "../components/account/reporting/client-report-slideshow"
);

afterEach(cleanup);

const fullDocument = <div>Full document</div>;

function makeSlides(): ReportSlide[] {
  return [
    {
      key: "cover",
      kind: "cover",
      title: "August 2026 SEO Report",
      subtitle: null,
      entries: [],
      cover: {
        companyName: "Northgate Dental",
        packageLabel: "Platinum SEO",
        laneLabel: "SEO Package",
        sentLabel: "Aug 20, 2026",
      },
    },
    {
      key: "recurring-technical_seo",
      kind: "recurring",
      title: "Technical SEO",
      subtitle: null,
      entries: [
        {
          label: "Site Audit Before",
          value: "200 issues",
          url: null,
          pairKey: "site_audit",
          pairRole: "before",
          pairBase: "Site Audit",
        },
        {
          label: "Site Audit After",
          value: "0 issues",
          url: null,
          pairKey: "site_audit",
          pairRole: "after",
          pairBase: "Site Audit",
        },
      ],
    },
    {
      key: "one-time-citations_100",
      kind: "one_time",
      title: "100 Citations",
      subtitle: null,
      entries: [
        {
          label: "100 Citations",
          value: "complete",
          url: "https://reports.example.invalid/citations",
          pairKey: null,
          pairRole: null,
          pairBase: null,
        },
      ],
      oneTimeCompleted: true,
    },
    {
      key: "closing",
      kind: "closing",
      title: "Another month of progress",
      subtitle:
        "We’ll continue building on this momentum in the next cycle. Thank you for continuing to grow with Wolf Forge.",
      entries: [],
    },
  ];
}

const renderDeck = (slides: ReportSlide[] = makeSlides()) =>
  render(<ClientReportSlideshow slides={slides}>{fullDocument}</ClientReportSlideshow>);

describe("client report slideshow", () => {
  it("opens automatically and presents the cover slide first", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "August 2026 SEO Report" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Prepared for Northgate Dental/u)).toBeInTheDocument();
    // The full document stays mounted behind the overlay.
    expect(screen.getByText("Full document")).toBeInTheDocument();
  });

  it("renders a thin progress bar with no numeric step text", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    const bar = within(dialog).getByTestId("report-progress-bar");
    // Slide 1 of 4 — the width is the only numeric signal.
    expect(bar).toHaveStyle({ width: "25%" });
    expect(within(dialog).queryByText(/\d+\s*\/\s*\d+/u)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/step \d/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/\d+%/u)).not.toBeInTheDocument();
  });

  it("advances one slide at a time with Next and Back", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    const back = within(dialog).getByRole("button", { name: "Back" });
    expect(back).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(
      within(dialog).getByRole("heading", { name: "Technical SEO" }),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(
      within(dialog).getByRole("heading", { name: "August 2026 SEO Report" }),
    ).toBeInTheDocument();
  });

  it("navigates with arrow keys", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(
      within(dialog).getByRole("heading", { name: "Technical SEO" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(
      within(dialog).getByRole("heading", { name: "August 2026 SEO Report" }),
    ).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    renderDeck();

    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("closes when the dimmed backdrop is clicked", async () => {
    renderDeck();

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("report-backdrop"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows a before/after pair as one transformation with both values", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(within(dialog).getByText("Site Audit")).toBeInTheDocument();
    expect(within(dialog).getByText("Before")).toBeInTheDocument();
    expect(within(dialog).getByText("200 issues")).toBeInTheDocument();
    expect(within(dialog).getByText("After")).toBeInTheDocument();
    expect(within(dialog).getByText("0 issues")).toBeInTheDocument();
  });

  it("renders a one-time setup slide only from the data, with its completed state", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(within(dialog).getByRole("heading", { name: "100 Citations" })).toBeInTheDocument();
    expect(within(dialog).getByText("One-time setup")).toBeInTheDocument();
    expect(within(dialog).getByText("Completed this cycle")).toBeInTheDocument();
  });

  it("renders a safe asset CTA without dumping the raw URL", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });

    const link = within(dialog).getByRole("link", {
      name: /View asset for 100 Citations/u,
    });
    expect(link).toHaveAttribute("href", "https://reports.example.invalid/citations");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).queryByText("https://reports.example.invalid/citations")).not.toBeInTheDocument();
  });

  it("ends on a closing slide with a continuity note and a full-report action", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(
      within(dialog).getByRole("heading", { name: "Another month of progress" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Thank you for continuing to grow with Wolf Forge/u),
    ).toBeInTheDocument();

    const messageLink = within(dialog).getByRole("link", { name: /Message Wolf Forge/u });
    expect(messageLink).toHaveAttribute("href", "/account/messages?compose=1");

    fireEvent.click(within(dialog).getByRole("button", { name: "View full report" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("advances the progress bar as slides change", async () => {
    renderDeck();

    const dialog = await screen.findByRole("dialog");
    const bar = within(dialog).getByTestId("report-progress-bar");

    expect(bar).toHaveStyle({ width: "25%" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(bar).toHaveStyle({ width: "50%" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(bar).toHaveStyle({ width: "75%" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(bar).toHaveStyle({ width: "100%" });
  });
});
