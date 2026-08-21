/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSafeReportUrl,
  summariseClientReports,
  toClientReportViews,
} from "../domain/reporting/projections";
import {
  reportLaneLabels,
  reportLanes,
  reportUrlSchema,
  sendClientReportSchema,
  type ClientReportRow,
} from "../domain/reporting/schema";
import { portalNavigationFor } from "../components/account/portal-nav-registry";

/**
 * Client reporting.
 *
 * Authorization lives in the database and is asserted in
 * supabase/tests/database/030_client_reporting.test.sql. These cover what the
 * browser is responsible for: refusing an unsafe link before it is ever sent,
 * ordering, read emphasis, safe external-link behaviour and the rail entry.
 */

const markClientReportReadAction = vi.fn<(input: { reportId: string }) => Promise<{ ok: boolean }>>(
  async () => ({ ok: true }),
);

vi.mock("../app/actions/reporting", () => ({
  markClientReportReadAction: (input: { reportId: string }) => markClientReportReadAction(input),
  listReportRecipientsAction: vi.fn(async () => []),
  sendClientReportAction: vi.fn(async () => ({ ok: true })),
}));

const { ClientReportingView } = await import(
  "../components/account/reporting/client-reporting"
);

afterEach(cleanup);
beforeEach(() => markClientReportReadAction.mockClear());

function row(overrides: Partial<ClientReportRow> = {}): ClientReportRow {
  return {
    report_id: "report-1",
    report_lane: "seo_package",
    package_label: "Platinum SEO",
    title: "August 2026 SEO Performance",
    report_url: "https://reports.example.invalid/aug-2026",
    sent_at: "2026-08-18T10:00:00.000Z",
    is_read: false,
    ...overrides,
  };
}

function renderReporting(rows: ClientReportRow[]) {
  return render(<ClientReportingView reports={toClientReportViews(rows)} />);
}

describe("report input contract", () => {
  it("accepts exactly the two primary reporting lanes", () => {
    expect(reportLanes).toEqual(["seo_package", "gmb_management"]);
    expect(Object.values(reportLaneLabels)).toEqual(["SEO Package", "GMB Management"]);
  });

  it("refuses an unsupported report type", () => {
    expect(
      sendClientReportSchema.safeParse({
        request_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        company_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
        report_lane: "newsletter",
        package_label: "Future Package",
        title: "X",
        report_url: "https://a.invalid",
      }).success,
    ).toBe(false);
  });

  it("refuses every unsafe link scheme", () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)  ",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "reports.example.invalid/aug",
      "",
    ]) {
      expect(reportUrlSchema.safeParse(value).success).toBe(false);
      expect(isSafeReportUrl(value)).toBe(false);
    }
  });

  it("accepts http and https", () => {
    expect(reportUrlSchema.safeParse("https://a.invalid/r").success).toBe(true);
    expect(reportUrlSchema.safeParse("http://a.invalid/r").success).toBe(true);
    expect(isSafeReportUrl("https://a.invalid/r")).toBe(true);
  });

  it("refuses a blank title", () => {
    expect(
      sendClientReportSchema.safeParse({
        request_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        company_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
        report_lane: "seo_package",
        package_label: "Platinum SEO",
        title: "   ",
        report_url: "https://a.invalid",
      }).success,
    ).toBe(false);
  });
});

describe("reporting projections", () => {
  it("orders newest first", () => {
    const views = toClientReportViews([
      row({ report_id: "old", sent_at: "2026-06-01T00:00:00.000Z" }),
      row({ report_id: "newest", sent_at: "2026-08-18T00:00:00.000Z" }),
      row({ report_id: "middle", sent_at: "2026-07-04T00:00:00.000Z" }),
    ]);

    expect(views.map((view) => view.id)).toEqual(["newest", "middle", "old"]);
  });

  it("summarises only what the rows actually contain", () => {
    const views = toClientReportViews([
      row({ report_id: "a", is_read: false }),
      row({ report_id: "b", is_read: true, sent_at: "2026-07-01T00:00:00.000Z" }),
    ]);

    expect(summariseClientReports(views)).toEqual({
      total: 2,
      unread: 1,
      latestLabel: "Aug 18, 2026",
    });
  });

  it("keeps an unrecognised lane visible rather than dropping the report", () => {
    const [view] = toClientReportViews([row({ report_lane: "invented" })]);
    expect(view?.laneLabel).toBe("Report");
    expect(view?.title).toBe("August 2026 SEO Performance");
  });
});

describe("client reporting page", () => {
  it("renders each report's package label, title and sent date", () => {
    renderReporting([row()]);

    expect(screen.getByText("Platinum SEO")).toBeInTheDocument();
    expect(screen.getByText("August 2026 SEO Performance")).toBeInTheDocument();
    expect(screen.getByText("Sent Aug 18, 2026")).toBeInTheDocument();
  });

  it("lists newest first in the DOM", () => {
    renderReporting([
      row({ report_id: "old", title: "June report", sent_at: "2026-06-01T00:00:00.000Z" }),
      row({ report_id: "new", title: "August report", sent_at: "2026-08-18T00:00:00.000Z" }),
    ]);

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("August report")).toBeInTheDocument();
    expect(within(items[1]!).getByText("June report")).toBeInTheDocument();
  });

  it("opens the native Wolf Forge report detail", () => {
    renderReporting([row()]);

    const link = screen.getByRole("link", { name: /August 2026 SEO Performance/u });
    expect(link).toHaveAttribute("href", "/account/reporting/report-1");
    expect(link).not.toHaveAttribute("target");
    expect(link).toHaveAccessibleName(/Read report/u);
  });

  it("never exposes a stored asset URL from the report list", () => {
    renderReporting([row({ report_url: "javascript:alert(1)" })]);

    const link = screen.getByRole("link", { name: /August 2026 SEO Performance/u });
    expect(link).toHaveAttribute("href", "/account/reporting/report-1");
    expect(link).not.toHaveAttribute("href", "javascript:alert(1)");
    expect(screen.queryByText("javascript:alert(1)")).not.toBeInTheDocument();
    expect(screen.getByText("August 2026 SEO Performance")).toBeInTheDocument();
  });

  it("marks a report new until it is read", () => {
    renderReporting([row({ is_read: false })]);
    expect(screen.getByText("New")).toBeInTheDocument();

    cleanup();

    renderReporting([row({ is_read: true })]);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("does not mark read merely because the report appeared in the list", () => {
    renderReporting([row()]);

    expect(markClientReportReadAction).not.toHaveBeenCalled();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("shows a calm empty state rather than a dead table", () => {
    renderReporting([]);

    expect(screen.getByText(/No reports yet/u)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("leads with the reports themselves, not a metrics strip", () => {
    const { container } = renderReporting([
      row(),
      row({ report_id: "b", sent_at: "2026-07-01T00:00:00.000Z" }),
    ]);

    // Counts the client can read off the list are furniture, not information.
    expect(container.querySelector("dl")).toBeNull();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    // The heading stands alone; no eyebrow repeating the word above it.
    expect(container.querySelector(".portal-eyebrow")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("client rail", () => {
  const granted = {
    portal_dashboard: true,
    portal_projects: true,
    portal_tickets: true,
    portal_reporting: true,
    portal_forms: true,
    portal_invoices: true,
    portal_subscriptions: true,
  };

  it("shows Reporting when the module is granted", () => {
    const items = portalNavigationFor(granted).flatMap((category) => category.items);
    const reporting = items.find((item) => item.id === "portal_reporting");

    expect(reporting?.label).toBe("Reporting");
    expect(reporting?.route).toBe("/account/reporting");
  });

  it("hides Reporting when the module is denied", () => {
    const items = portalNavigationFor({ ...granted, portal_reporting: false }).flatMap(
      (category) => category.items,
    );

    expect(items.find((item) => item.id === "portal_reporting")).toBeUndefined();
  });

  it("badges the real unread count, and nothing when there is none", () => {
    const counts = { onboarding: null, messages: null, projects: null, reporting: 3 };
    const withBadge = portalNavigationFor(granted, counts)
      .flatMap((category) => category.items)
      .find((item) => item.id === "portal_reporting");

    expect(withBadge?.count).toBe(3);
    expect(withBadge?.countIsActionable).toBe(true);

    const zero = portalNavigationFor(granted, { ...counts, reporting: 0 })
      .flatMap((category) => category.items)
      .find((item) => item.id === "portal_reporting");

    expect(zero?.count).toBeUndefined();
  });
});
