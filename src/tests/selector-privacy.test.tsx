/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FormPublishedSchema } from "../domain/forms/schema";
import type { ClientReportDocument } from "../domain/reporting/schema";
import type { StoreCatalog, StoreFolderView, StoreServiceView } from "../domain/services/store-projections";

/**
 * Selector-privacy regression suite.
 *
 * Vercel Speed Insights' Web Vital attribution reads whatever DOM `id` sits
 * closest to the element that triggered a metric, so any private database id
 * or operator-authored content living in an `id`/`aria-*` attribute would
 * reach telemetry even though the sanitizer in
 * `src/domain/observability/speed-insights-privacy.ts` never sees it — that
 * sanitizer only ever inspects `event.url`. This suite proves the four
 * selector leaks an independent Codex review found are closed, using
 * deliberately hostile fixture values (real-shaped UUIDs, an
 * operator-written section key, an ISO calendar date) that would show up
 * immediately in a DOM id if the fix regressed.
 */

vi.mock("../app/actions/forms", () => ({
  submitAssignedFormAction: vi.fn(),
  submitPublicFormAction: vi.fn(),
}));
vi.mock("../app/actions/store-interest", () => ({
  recordStoreInterestAction: vi.fn(),
}));
vi.mock("../app/actions/reporting", () => ({
  markClientReportReadAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode; [key: string]: unknown }) => <a {...props} />,
}));

beforeAll(() => {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "10000000-0000-4000-8000-000000000000" },
      configurable: true,
    });
  }
});
afterEach(cleanup);

const { FormRenderer } = await import("../components/forms/form-renderer");
const { StoreCatalogView } = await import("../components/account/store/store-catalog");
const { resetCartForTests } = await import("../components/account/cart/cart-store");
const { ClientReportViewer } = await import("../components/account/reporting/client-report-viewer");
const { DatePicker } = await import("../components/ui/date-picker");

const privateFieldUuid = "9f1c2e3a-52b1-4e2a-9d3a-c0ffee000001";
const privateFolderUuid = "9f1c2e3a-52b1-4e2a-9d3a-c0ffee000002";
const privateSectionKey = "confidential_churn_risk_notes";

describe("Form renderer: field DOM id excludes the database stable_field_key", () => {
  function formSchema(): FormPublishedSchema {
    return {
      form_id: "form-1",
      form_type: "contact",
      canonical_key: "contact-us",
      form_version_id: "version-1",
      version_number: 1,
      schema_hash: "hash",
      title: "Contact us",
      information_html: null,
      visibility: "public",
      type_config: {},
      fields: [
        {
          stable_field_key: privateFieldUuid,
          sort_order: 0,
          field_type: "text",
          label: "Your name",
          placeholder: null,
          help_html: null,
          default_value: null,
          required: true,
          settings: {},
          options: [],
          services: [],
        },
      ],
      rules: [],
    };
  }

  it("keys the input id/htmlFor on position, never on the field's UUID", () => {
    render(<FormRenderer schema={formSchema()} />);

    const input = screen.getByLabelText(/^Your name/) as HTMLInputElement;
    expect(input.id).not.toContain(privateFieldUuid);
    expect(input.id).toBe("form-field-0");

    const label = screen.getByText("Your name").closest("label") as HTMLLabelElement;
    expect(label.getAttribute("for")).toBe(input.id);
  });
});

describe("Store catalog: section DOM id excludes the database folder id", () => {
  function service(name: string, folderId: string): StoreServiceView {
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      folderId,
      priceLabel: "$297",
      amount: 297,
      currency: "USD",
      recurring: false,
      cadence: "one-time",
      recurringLabel: null,
      imageUrl: null,
      descriptionHtml: "",
      summary: `${name} summary line.`,
    };
  }

  function catalog(): StoreCatalog {
    const folder: StoreFolderView = {
      id: privateFolderUuid,
      name: "Local SEO",
      description: "Rank in your city",
      services: [service("Local SEO Starter", privateFolderUuid)],
    };
    return { folders: [folder], ungrouped: [], serviceCount: 1 };
  }

  it("keys the section id/aria-labelledby on position, never on the folder's UUID", () => {
    resetCartForTests();
    render(<StoreCatalogView catalog={catalog()} />);

    const heading = screen.getByRole("heading", { level: 2, name: "Local SEO" });
    expect(heading.id).not.toContain(privateFolderUuid);
    expect(heading.id).toBe("store-section-0");

    const section = heading.closest("section") as HTMLElement;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
  });
});

describe("Client report viewer: section heading DOM id excludes the operator-authored section key", () => {
  function report(): ClientReportDocument {
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
      reporting_period_month: "2026-08-01",
      is_read: true,
      sections: [
        {
          section_key: privateSectionKey,
          title: "Ranking",
          entries: [{ label: "Ranking", value: "Improved from 12 to 4", url: null }],
        },
        {
          section_key: "site_audits",
          title: "Site Audits",
          entries: [{ label: "Site Audit", value: "Completed", url: null }],
        },
      ],
    };
  }

  it("keys the heading id/aria-labelledby on position, never on the section_key", () => {
    render(<ClientReportViewer report={report()} />);

    const region = screen.getByRole("region", { name: "Ranking" });
    const labelledBy = region.getAttribute("aria-labelledby");
    expect(labelledBy).not.toContain(privateSectionKey);
    expect(labelledBy).toBe("report-section-1");

    const heading = within(region).getByRole("heading", { level: 2 });
    expect(heading.id).toBe(labelledBy);

    // The sidebar "In this report" jump link must still resolve to the same heading.
    const jumpLink = screen.getByRole("link", { name: "Ranking" });
    expect(jumpLink.getAttribute("href")).toBe(`#${heading.id}`);
  });
});

describe("Date picker: day option DOM id excludes the ISO calendar date", () => {
  const isoDatePattern = /\d{4}-\d{2}-\d{2}/;

  it("keys every day button id on grid position, never on its date", () => {
    render(
      <DatePicker
        name="due_date"
        label="Due date"
        value="2026-08-15"
        onChange={vi.fn()}
        today="2026-08-15"
        menuLabel="Choose a due date"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Due date/ }));

    const grid = screen.getByRole("grid", { name: "Day grid" });
    const dayButtons = within(grid).getAllByRole("button");
    expect(dayButtons.length).toBeGreaterThan(0);

    for (const button of dayButtons) {
      expect(button.id).not.toMatch(isoDatePattern);
      expect(button.id).toMatch(/-day-\d+$/u);
    }

    const activeDescendant = grid.getAttribute("aria-activedescendant");
    expect(activeDescendant).not.toBeNull();
    expect(activeDescendant).not.toMatch(isoDatePattern);
    expect(dayButtons.some((button) => button.id === activeDescendant)).toBe(true);
  });

  it("keeps aria-activedescendant tracking the keyboard cursor across navigation", () => {
    render(
      <DatePicker
        name="due_date"
        label="Due date"
        value="2026-08-15"
        onChange={vi.fn()}
        today="2026-08-15"
        menuLabel="Choose a due date"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Due date/ }));
    const grid = screen.getByRole("grid", { name: "Day grid" });
    const before = grid.getAttribute("aria-activedescendant");

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    const after = grid.getAttribute("aria-activedescendant");

    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after).not.toMatch(isoDatePattern);
    expect(document.getElementById(after as string)).not.toBeNull();
  });
});
