/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientReportDocument } from "../domain/reporting/schema";

const refresh = vi.fn();
const markClientReportReadAction = vi.fn<
  (input: { reportId: string }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("../app/actions/reporting", () => ({
  markClientReportReadAction: (input: { reportId: string }) =>
    markClientReportReadAction(input),
}));

const { ClientReportViewer } = await import(
  "../components/account/reporting/client-report-viewer"
);

afterEach(cleanup);
beforeEach(() => {
  refresh.mockClear();
  markClientReportReadAction.mockClear();
  markClientReportReadAction.mockResolvedValue({ ok: true });
});

function report(overrides: Partial<ClientReportDocument> = {}): ClientReportDocument {
  return {
    report_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    company_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    company_name: "Northgate Dental",
    report_lane: "seo_package",
    package_label: "Platinum SEO",
    title: "August 2026 SEO Report",
    status: "sent",
    sent_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-20T10:00:00.000Z",
    is_read: true,
    sections: [
      {
        section_key: "ranking",
        title: "Ranking",
        entries: [
          { label: "Ranking", value: "Improved from 12 to 4", url: null },
          {
            label: "Blog Posts",
            value: "4 posts completed",
            url: "https://reports.example.invalid/blog",
          },
        ],
      },
      {
        section_key: "site_audits",
        title: "Site Audits",
        entries: [
          {
            label: "Site Audit Before",
            value: null,
            url: "https://reports.example.invalid/before",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("native client report viewer", () => {
  it("renders the report header from real document metadata", () => {
    render(<ClientReportViewer report={report()} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "August 2026 SEO Report",
    );
    expect(screen.getByText(/Prepared for Northgate Dental/u)).toBeInTheDocument();
    expect(screen.getByText("SEO Package")).toBeInTheDocument();
    expect(screen.getByText("Platinum SEO")).toBeInTheDocument();
    expect(screen.getByText("Aug 20, 2026")).toBeInTheDocument();
  });

  it("preserves ordered sections and ordered entries", () => {
    render(<ClientReportViewer report={report()} />);

    const sections = screen.getAllByRole("region");
    expect(sections.map((node) => node.getAttribute("aria-labelledby"))).toEqual([
      "report-section-ranking-1",
      "report-section-site_audits-2",
    ]);

    const terms = sections.flatMap((section) =>
      within(section).getAllByRole("term").map((node) => node.textContent),
    );
    expect(terms).toEqual(["Ranking", "Blog Posts", "Site Audit Before"]);
  });

  it("renders a value-only entry as native report content", () => {
    render(<ClientReportViewer report={report()} />);
    expect(screen.getByText("Improved from 12 to 4")).toBeInTheDocument();
  });

  it("renders a URL-only entry as a named external asset control", () => {
    render(<ClientReportViewer report={report()} />);

    const link = screen.getByRole("link", { name: /View asset for Site Audit Before/u });
    expect(link).toHaveAttribute("href", "https://reports.example.invalid/before");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("View asset");
  });

  it("renders value and URL together without printing the raw URL", () => {
    render(<ClientReportViewer report={report()} />);

    expect(screen.getByText("4 posts completed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View asset for Blog Posts/u })).toBeInTheDocument();
    expect(screen.queryByText("https://reports.example.invalid/blog")).not.toBeInTheDocument();
  });

  it("never makes an unsafe stored URL clickable", () => {
    render(
      <ClientReportViewer
        report={report({
          sections: [
            {
              section_key: "site_audits",
              title: "Site Audits",
              entries: [{ label: "Unsafe asset", value: null, url: "javascript:alert(1)" }],
            },
          ],
        })}
      />,
    );

    expect(screen.queryByRole("link", { name: /Unsafe asset/u })).not.toBeInTheDocument();
    expect(screen.queryByText("javascript:alert(1)")).not.toBeInTheDocument();
    expect(screen.getByText("No detail included")).toBeInTheDocument();
  });

  it("renders a legacy quick-send report through the native structure", () => {
    render(
      <ClientReportViewer
        report={report({
          package_label: "Legacy SEO",
          title: "Legacy quick-send report",
          sections: [
            {
              section_key: "external_report",
              title: "Report",
              entries: [
                {
                  label: "View report",
                  value: null,
                  url: "https://reports.example.invalid/legacy",
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Report" })).toBeInTheDocument();
    expect(screen.getByText("View report", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View asset for View report/u })).toHaveAttribute(
      "href",
      "https://reports.example.invalid/legacy",
    );
  });

  it("renders an empty section gracefully without fabricating entries", () => {
    render(
      <ClientReportViewer
        report={report({
          sections: [{ section_key: "technical_seo", title: "Technical SEO", entries: [] }],
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Technical SEO" })).toBeInTheDocument();
    expect(screen.getByText("No updates were included in this section.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Technical SEO" })).queryByRole("term"),
    ).not.toBeInTheDocument();
  });

  it("keeps long values in readable document structure without form controls", () => {
    const longValue = "A detailed result ".repeat(120).trim();
    render(
      <ClientReportViewer
        report={report({
          sections: [
            {
              section_key: "technical_seo",
              title: "Technical SEO",
              entries: [{ label: "Technical SEO", value: longValue, url: null }],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(longValue)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks an unread report only after the detail viewer opens", async () => {
    render(<ClientReportViewer report={report({ is_read: false })} />);

    await waitFor(() => {
      expect(markClientReportReadAction).toHaveBeenCalledWith({
        reportId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      });
    });
    expect(markClientReportReadAction).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite read state when the profile already read the report", () => {
    render(<ClientReportViewer report={report({ is_read: true })} />);
    expect(markClientReportReadAction).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps report navigation and asset actions as real keyboard links", () => {
    render(<ClientReportViewer report={report()} />);
    expect(screen.getByRole("link", { name: "All reports" })).toHaveAttribute(
      "href",
      "/account/reporting",
    );
    expect(screen.getByRole("navigation", { name: "Report sections" })).toBeInTheDocument();
  });

  it("does not visually repeat a single-entry label that repeats its section title", () => {
    render(
      <ClientReportViewer
        report={report({
          sections: [
            {
              section_key: "youtube_stack",
              title: "YouTube Stack",
              entries: [{ label: "Youtube Stack", value: "4 videos published", url: null }],
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "YouTube Stack" })).toBeInTheDocument();
    expect(screen.getByText("4 videos published")).toBeInTheDocument();
    // The stored label is still present as entry data, just de-emphasised.
    const section = screen.getByRole("region", { name: "YouTube Stack" });
    expect(within(section).getByRole("term")).toHaveTextContent("Youtube Stack");
  });

  it("keeps every label in a multi-entry section", () => {
    render(
      <ClientReportViewer
        report={report({
          sections: [
            {
              section_key: "technical_seo",
              title: "Technical SEO",
              entries: [
                { label: "Crawl errors", value: "0 found", url: null },
                { label: "Page speed", value: "72 mobile", url: null },
                { label: "Indexed pages", value: "148", url: null },
              ],
            },
          ],
        })}
      />,
    );

    const section = screen.getByRole("region", { name: "Technical SEO" });
    const terms = within(section)
      .getAllByRole("term")
      .map((node) => node.textContent);
    expect(terms).toEqual(["Crawl errors", "Page speed", "Indexed pages"]);
  });
});
