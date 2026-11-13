/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addEntry,
  addSection,
  countEntries,
  findDraftProblems,
  moveEntry,
  moveSection,
  normalizeDraftSections,
  removeEntry,
  removeSection,
  renameSection,
  toSectionKey,
  uniqueSectionKey,
  updateEntry,
} from "../domain/reporting/builder";
import {
  blogPostsCompletedValue,
  createServiceReportDraft,
  reportingProfileForService,
  reportingServiceIds,
} from "../domain/reporting/service-profiles";
import {
  countInternalReports,
  toInternalReportViews,
} from "../domain/reporting/projections";
import {
  createReportDraftSchema,
  internalReportDocumentSchema,
  reportDraftEntrySchema,
  reportDraftSectionsSchema,
  saveReportDraftSchema,
  type InternalReportDocument,
  type InternalReportRow,
  type ReportDraftSectionInput,
} from "../domain/reporting/schema";
import { navigationCategories } from "../components/shell/nav-registry";
import { FloatingCallWindow } from "../components/calls/floating-call-window";

/**
 * The internal Reporting builder.
 *
 * Authorization is the database's job and is asserted in
 * supabase/tests/database/031_reporting_builder.test.sql. These cover what the
 * browser owns: the editing operations, what gets sent to the RPC, what the
 * operator is warned about before a round trip, and that the send is a
 * deliberate, confirmed act rather than a side effect of saving.
 */

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; reportId: string } | { ok: false; error: string };
type ServiceChoicesResult =
  | {
      ok: true;
      fallback: boolean;
      choices: Array<{
        serviceId: string;
        serviceName: string;
        subscriptionId: string | null;
        subscriptionStatus: string | null;
      }>;
    }
  | { ok: false; error: string };

const createdReportId = "3f2504e0-4f89-41d3-9a0c-0305e82c3310";

const saveReportDraftAction = vi.fn<(input: SaveInput) => Promise<ActionResult>>(
  async () => ({ ok: true }),
);
const sendReportDraftAction = vi.fn<(input: unknown) => Promise<ActionResult>>(
  async () => ({ ok: true }),
);
const createReportDraftAction = vi.fn<(input: CreateInput) => Promise<CreateResult>>(
  async () => ({ ok: true, reportId: createdReportId }),
);
const createServiceReportDraftAction = vi.fn<
  (input: CreateServiceInput) => Promise<CreateResult>
>(async () => ({ ok: true, reportId: createdReportId }));
const listReportServiceChoicesAction = vi.fn<
  (_input: { companyId: string }) => Promise<ServiceChoicesResult>
>(async () => ({
  ok: true,
  fallback: false,
  choices: [
    {
      serviceId: reportingServiceIds.platinumSeo100,
      serviceName: "Platinum SEO Success Blueprint (100 Targeted Keywords)",
      subscriptionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
      subscriptionStatus: "active",
    },
  ],
}));
const discardReportDraftAction = vi.fn<(input: unknown) => Promise<ActionResult>>(
  async () => ({ ok: true }),
);

type SaveInput = {
  reportId: string;
  reportLane: string;
  packageLabel: string;
  title: string;
  wizardStepKey?: string | null;
  sections: ReportDraftSectionInput[];
};

type CreateInput = {
  requestId: string;
  companyId: string;
  reportLane: string;
  packageLabel: string;
  title: string;
  sections: ReportDraftSectionInput[];
};

type CreateServiceInput = {
  requestId: string;
  companyId: string;
  serviceId: string;
  subscriptionId: string | null;
  title: string;
};

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock("../app/actions/reporting", () => ({
  saveReportDraftAction: (input: SaveInput) => saveReportDraftAction(input),
  sendReportDraftAction: (input: unknown) => sendReportDraftAction(input),
  createReportDraftAction: (input: CreateInput) => createReportDraftAction(input),
  createServiceReportDraftAction: (input: CreateServiceInput) =>
    createServiceReportDraftAction(input),
  listReportServiceChoicesAction: (input: { companyId: string }) =>
    listReportServiceChoicesAction(input),
  discardReportDraftAction: (input: unknown) => discardReportDraftAction(input),
  markClientReportReadAction: vi.fn(async () => ({ ok: true })),
  listReportRecipientsAction: vi.fn(async () => []),
  sendClientReportAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

/*
 * The completion faces navigate by clicking a hidden <Link> (a Link resolves
 * the current router at render time, which a captured router.push cannot do
 * across the post-send route refresh). The real next/link talks to the router
 * through internal context the mocked useRouter cannot see, so Link is mocked
 * to a plain anchor that reports the same navigation to routerPush.
 */
type MockLinkProps = {
  href?: string;
  children?: ReactNode;
  ref?: React.Ref<HTMLAnchorElement>;
  [key: string]: unknown;
};

vi.mock("next/link", () => {
  // React 19 passes ref as a regular prop to function components.
  return {
    default: function MockNextLink(props: MockLinkProps) {
      const href = props.href;
      return (
        <a
          ref={props.ref}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            if (href) routerPush(href);
          }}
        >
          {props.children}
        </a>
      );
    },
  };
});

const { ReportBuilder } = await import("../components/reporting/report-builder");
const { ReportPreview } = await import("../components/reporting/report-preview");
const { ReportWizard } = await import("../components/reporting/report-wizard");
const { NewReportForm } = await import("../components/reporting/new-report-form");

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

beforeEach(() => {
  saveReportDraftAction.mockClear().mockResolvedValue({ ok: true });
  sendReportDraftAction.mockClear().mockResolvedValue({ ok: true });
  createReportDraftAction.mockClear().mockResolvedValue({ ok: true, reportId: createdReportId });
  createServiceReportDraftAction.mockClear().mockResolvedValue({
    ok: true,
    reportId: createdReportId,
  });
  listReportServiceChoicesAction.mockClear().mockResolvedValue({
    ok: true,
    fallback: false,
    choices: [
      {
        serviceId: reportingServiceIds.platinumSeo100,
        serviceName: "Platinum SEO Success Blueprint (100 Targeted Keywords)",
        subscriptionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
        subscriptionStatus: "active",
      },
    ],
  });
  discardReportDraftAction.mockClear().mockResolvedValue({ ok: true });
  routerPush.mockClear();
  routerRefresh.mockClear();
});

function section(
  key: string,
  title: string,
  entries: ReportDraftSectionInput["entries"] = [],
): ReportDraftSectionInput {
  return { section_key: key, title, entries };
}

function documentFixture(
  overrides: Partial<InternalReportDocument> = {},
): InternalReportDocument {
  return {
    report_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    company_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    company_name: "Northgate Dental",
    report_lane: "seo_package",
    package_label: "Platinum SEO",
    title: "August 2026 SEO Report",
    status: "draft",
    sent_at: null,
    updated_at: "2026-08-20T10:00:00.000Z",
    reporting_period_month: "2026-08-01",
    sections: [
      section("geo_ranking", "GEO Ranking", [
        { label: "junk removal", value: "RANK 2.12", url: null },
      ]),
      section("technical_seo", "Technical SEO", [
        { label: "Technical SEO", value: "Technical SEO updated", url: null },
      ]),
    ],
    ...overrides,
  };
}

function wizardDocument(
  overrides: Partial<InternalReportDocument> = {},
): InternalReportDocument {
  const profile = reportingProfileForService(reportingServiceIds.platinumSeo100)!;
  return documentFixture({
    service_id: profile.serviceId,
    service_name: profile.serviceName,
    subscription_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
    wizard_step_key: "technical_seo",
    package_label: profile.packageLabel,
    sections: createServiceReportDraft(profile),
    ...overrides,
  });
}

function gmbWizardDocument(
  overrides: Partial<InternalReportDocument> = {},
): InternalReportDocument {
  const profile = reportingProfileForService(reportingServiceIds.gmbManagement)!;
  return documentFixture({
    service_id: profile.serviceId,
    service_name: profile.serviceName,
    subscription_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3318",
    wizard_step_key: "gmb_content",
    report_lane: profile.reportLane,
    package_label: profile.packageLabel,
    sections: createServiceReportDraft(profile),
    ...overrides,
  });
}

/** A Platinum draft that already carries an entered blog count on the Blog Posts entry. */
function wizardDocumentWithBlogCount(
  count: number,
  overrides: Partial<InternalReportDocument> = {},
): InternalReportDocument {
  const profile = reportingProfileForService(reportingServiceIds.platinumSeo100)!;
  const sections = createServiceReportDraft(profile).map((section) =>
    section.section_key === "blog_content"
      ? {
          ...section,
          entries: section.entries.map((entry) =>
            entry.label === "Blog Posts"
              ? { ...entry, value: blogPostsCompletedValue(count) }
              : entry,
          ),
        }
      : section,
  );
  return wizardDocument({ ...overrides, sections });
}

/** A fresh wizard draft for any supported profile, opened at the Blog step. */
function wizardDocumentForProfile(
  serviceId: string,
  overrides: Partial<InternalReportDocument> = {},
): InternalReportDocument {
  const profile = reportingProfileForService(serviceId)!;
  return documentFixture({
    service_id: profile.serviceId,
    service_name: profile.serviceName,
    subscription_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
    wizard_step_key: "blog_content",
    report_lane: profile.reportLane,
    package_label: profile.packageLabel,
    sections: createServiceReportDraft(profile),
    ...overrides,
  });
}

/** Mirrors jsonb_strip_nulls in app_get_internal_report for a brand-new draft. */
function freshServiceAwareRpcDocument(serviceId: string, wizardStepKey: string) {
  const profile = reportingProfileForService(serviceId)!;
  return {
    ...documentFixture({ sections: [] }),
    service_id: profile.serviceId,
    service_name: profile.serviceName,
    subscription_id: null,
    wizard_step_key: wizardStepKey,
    report_lane: profile.reportLane,
    package_label: profile.packageLabel,
    sections: createServiceReportDraft(profile).map((draftSection) => ({
      section_key: draftSection.section_key,
      title: draftSection.title,
      entries: draftSection.entries.map((entry) => ({
        label: entry.label,
        ...(entry.one_time_item_key
          ? {
              one_time_item_key: entry.one_time_item_key,
              one_time_completed: entry.one_time_completed,
            }
          : {}),
      })),
    })),
  };
}

/* ==================================================== editing operations */

describe("section editing", () => {
  const base = [section("a", "Alpha"), section("b", "Beta"), section("c", "Gamma")];

  it("adds a section with a derived, unique key", () => {
    const added = addSection(base, "Client Wins");
    expect(added).toHaveLength(4);
    expect(added[3]).toEqual({ section_key: "client_wins", title: "Client Wins", entries: [] });
  });

  it("suffixes a duplicate custom key rather than refusing the section", () => {
    expect(uniqueSectionKey([section("notes", "Notes")], "notes")).toBe("notes_2");
  });

  it("reduces a heading to a legal section key", () => {
    expect(toSectionKey("GEO Ranking — August!")).toBe("geo_ranking_august");
    expect(toSectionKey("★★★")).toBe("custom_section");
  });

  it("removes a section without touching its neighbours", () => {
    expect(removeSection(base, 1).map((item) => item.section_key)).toEqual(["a", "c"]);
  });

  it("renames without re-keying, so identity survives typing", () => {
    const renamed = renameSection(base, 0, "Alpha Results");
    expect(renamed[0]!.title).toBe("Alpha Results");
    expect(renamed[0]!.section_key).toBe("a");
  });

  it("moves a section up and down and leaves the ends alone", () => {
    expect(moveSection(base, 2, -1).map((item) => item.section_key)).toEqual(["a", "c", "b"]);
    expect(moveSection(base, 0, 1).map((item) => item.section_key)).toEqual(["b", "a", "c"]);
    expect(moveSection(base, 0, -1).map((item) => item.section_key)).toEqual(["a", "b", "c"]);
    expect(moveSection(base, 2, 1).map((item) => item.section_key)).toEqual(["a", "b", "c"]);
  });

  it("never mutates the array it was given", () => {
    const original = [...base];
    moveSection(base, 0, 1);
    removeSection(base, 0);
    addSection(base, "New");
    expect(base).toEqual(original);
  });
});

describe("entry editing", () => {
  const base = [
    section("a", "Alpha", [
      { label: "One", value: null, url: null },
      { label: "Two", value: null, url: null },
    ]),
    section("b", "Beta"),
  ];

  it("adds a blank entry to the right section only", () => {
    const added = addEntry(base, 1);
    expect(added[1]!.entries).toEqual([{ label: "", value: null, url: null }]);
    expect(added[0]!.entries).toHaveLength(2);
  });

  it("removes one entry", () => {
    expect(removeEntry(base, 0, 0)[0]!.entries.map((entry) => entry.label)).toEqual(["Two"]);
  });

  it("reorders entries within their own section", () => {
    expect(moveEntry(base, 0, 0, 1)[0]!.entries.map((entry) => entry.label)).toEqual([
      "Two",
      "One",
    ]);
    expect(moveEntry(base, 0, 0, -1)[0]!.entries.map((entry) => entry.label)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("patches one field of one entry", () => {
    const patched = updateEntry(base, 0, 1, { value: "In progress" });
    expect(patched[0]!.entries[1]).toEqual({ label: "Two", value: "In progress", url: null });
    expect(patched[0]!.entries[0]!.value).toBeNull();
  });

  it("counts entries across the whole report", () => {
    expect(countEntries(base)).toBe(2);
  });
});

/* ============================================ value / URL independence */

describe("entries carry value, URL, or both", () => {
  it("accepts a native value with no URL", () => {
    expect(
      reportDraftEntrySchema.parse({ label: "GMB Verification", value: "GMB need to be verified", url: "" }),
    ).toEqual({ label: "GMB Verification", value: "GMB need to be verified", url: null });
  });

  it("accepts a URL with no value", () => {
    expect(
      reportDraftEntrySchema.parse({
        label: "Site Audit Before",
        value: "",
        url: "https://reports.example.invalid/audit-before",
      }),
    ).toEqual({
      label: "Site Audit Before",
      value: null,
      url: "https://reports.example.invalid/audit-before",
    });
  });

  it("accepts a value and a URL together", () => {
    expect(
      reportDraftEntrySchema.parse({
        label: "Blog Posts",
        value: "4 posts completed",
        url: "https://reports.example.invalid/blog",
      }),
    ).toEqual({
      label: "Blog Posts",
      value: "4 posts completed",
      url: "https://reports.example.invalid/blog",
    });
  });

  it("refuses an entry with no label", () => {
    expect(reportDraftEntrySchema.safeParse({ label: "  ", value: "x", url: null }).success).toBe(
      false,
    );
  });

  it("refuses an unsafe scheme wherever it appears", () => {
    expect(
      reportDraftEntrySchema.safeParse({ label: "Bad", value: null, url: "javascript:alert(1)" })
        .success,
    ).toBe(false);
  });

  it("drops rows the operator started and abandoned", () => {
    const normalized = normalizeDraftSections([
      section("a", " Alpha ", [
        { label: "  ", value: "  ", url: "  " },
        { label: " Ranking ", value: " Improved from 12 to 4 ", url: "" },
      ]),
    ]);

    expect(normalized).toEqual([
      {
        section_key: "a",
        title: "Alpha",
        entries: [{ label: "Ranking", value: "Improved from 12 to 4", url: null }],
      },
    ]);
  });
});

describe("draft problems, reported before a round trip", () => {
  it("is silent about a well-formed draft", () => {
    expect(
      findDraftProblems([
        section("a", "Alpha", [{ label: "Ranking", value: "RANK 2", url: null }]),
      ]),
    ).toEqual([]);
  });

  it("points at the entry on screen, not at a renumbered copy", () => {
    const problems = findDraftProblems([
      section("a", "Alpha", [
        { label: "", value: "", url: "" },
        { label: "", value: "Something happened", url: null },
      ]),
    ]);

    expect(problems).toEqual([
      { sectionIndex: 0, entryIndex: 1, message: "Every entry needs a label." },
    ]);
  });

  it("reports a section with no title and an unsafe link", () => {
    const problems = findDraftProblems([
      section("a", "  ", [{ label: "Audit", value: null, url: "ftp://files.invalid" }]),
    ]);

    expect(problems.map((problem) => problem.message)).toEqual([
      "Give this section a title.",
      "Links must start with http:// or https://.",
    ]);
  });
});

/* ============================================== payload contracts */

describe("what the RPCs are asked to store", () => {
  it("accepts a full create payload", () => {
    const profile = reportingProfileForService(reportingServiceIds.platinumSeo100)!;
    expect(
      createReportDraftSchema.safeParse({
        request_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        company_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
        service_id: profile.serviceId,
        subscription_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
        report_lane: "seo_package",
        package_label: profile.packageLabel,
        title: "August 2026 SEO Report",
        wizard_step_key: "technical_seo",
        sections: createServiceReportDraft(profile),
      }).success,
    ).toBe(true);
  });

  it("refuses a lane that is not one of the two", () => {
    expect(
      saveReportDraftSchema.safeParse({
        report_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        report_lane: "website",
        package_label: "Anything",
        title: "X",
        sections: [],
      }).success,
    ).toBe(false);
  });

  it("refuses more sections than a report may hold", () => {
    const tooMany = Array.from({ length: 101 }, (_, index) =>
      section(`s${index}`, `Section ${index}`),
    );
    expect(reportDraftSectionsSchema.safeParse(tooMany).success).toBe(false);
  });

  it("parses the document the internal report RPC returns", () => {
    const parsed = internalReportDocumentSchema.parse({
      ...documentFixture(),
      sections: [
        {
          section_key: "geo_ranking",
          title: "GEO Ranking",
          entries: [{ label: "junk removal", value: "RANK 2.12", url: null }],
        },
      ],
    });

    expect(parsed.status).toBe("draft");
    expect(parsed.sections[0]!.entries[0]!.value).toBe("RANK 2.12");
  });

  it("reads a fresh service-aware RPC document after null entry fields are stripped", () => {
    const parsed = internalReportDocumentSchema.parse(
      freshServiceAwareRpcDocument(reportingServiceIds.platinumSeo100, "technical_seo"),
    );

    expect(parsed.report_id).toBe(documentFixture().report_id);
    expect(parsed.wizard_step_key).toBe("technical_seo");
    expect(parsed.sections[0]?.section_key).toBe("technical_seo");
    expect(parsed.sections[0]?.entries[0]).toMatchObject({
      label: "Site Audit Before",
      value: null,
      url: null,
    });
  });
});

/* ================================================ workspace list */

describe("the internal list", () => {
  function row(overrides: Partial<InternalReportRow> = {}): InternalReportRow {
    return {
      report_id: "report-1",
      company_id: "company-1",
      company_name: "Northgate Dental",
      report_lane: "seo_package",
      package_label: "Platinum SEO",
      title: "August 2026 SEO Report",
      status: "sent",
      section_count: 14,
      entry_count: 40,
      sent_at: "2026-08-18T10:00:00.000Z",
      updated_at: "2026-08-18T10:00:00.000Z",
      sent_by_name: "William",
      ...overrides,
    };
  }

  it("separates drafts from sent reports", () => {
    const views = toInternalReportViews([
      row(),
      row({ report_id: "report-2", status: "draft", sent_at: null }),
    ]);

    expect(countInternalReports(views)).toEqual({ draft: 1, sent: 1, total: 2 });
  });

  it("labels a draft by when it was edited and a sent report by when it was sent", () => {
    const [sent] = toInternalReportViews([row()]);
    const [draft] = toInternalReportViews([
      row({ status: "draft", sent_at: null, updated_at: "2026-08-20T09:00:00.000Z" }),
    ]);

    expect(sent!.timeLabel.startsWith("Sent ")).toBe(true);
    expect(draft!.timeLabel.startsWith("Edited ")).toBe(true);
  });

  it("orders by the timestamp that actually applies, newest first", () => {
    const views = toInternalReportViews([
      row({ report_id: "older", sent_at: "2026-08-01T10:00:00.000Z" }),
      row({
        report_id: "newer-draft",
        status: "draft",
        sent_at: null,
        updated_at: "2026-08-20T10:00:00.000Z",
      }),
    ]);

    expect(views.map((view) => view.id)).toEqual(["newer-draft", "older"]);
  });

  it("treats an unknown status as not yet delivered", () => {
    const [view] = toInternalReportViews([row({ status: "queued" })]);
    expect(view!.status).toBe("draft");
  });
});

/* ================================================ the rail entry */

describe("internal navigation", () => {
  it("exposes Reporting on a module key the database also owns", () => {
    const reporting = navigationCategories
      .flatMap((category) => category.items)
      .find((item) => item.id === "reporting");

    expect(reporting).toEqual({ id: "reporting", label: "Reporting", route: "/reporting" });
  });
});

/* ================================================ the builder screen */

describe("the builder", () => {
  it("prefills the saved sections and entries", () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    expect(screen.getByDisplayValue("August 2026 SEO Report")).toBeInTheDocument();
    expect(screen.getByDisplayValue("GEO Ranking")).toBeInTheDocument();
    expect(screen.getByDisplayValue("RANK 2.12")).toBeInTheDocument();
    expect(screen.getByText("Northgate Dental")).toBeInTheDocument();
  });

  it("saves the edited report rather than the one it was given", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.change(screen.getByDisplayValue("RANK 2.12"), {
      target: { value: "RANK 1.22" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await screen.findByRole("heading", { name: "Draft saved" });

    expect(saveReportDraftAction).toHaveBeenCalledTimes(1);
    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(payload.sections[0]!.entries[0]!.value).toBe("RANK 1.22");
  });

  it("adds and removes sections and entries", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add section" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove GEO Ranking" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await screen.findByRole("heading", { name: "Draft saved" });

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(payload.sections.map((item) => item.section_key)).toEqual([
      "technical_seo",
      "new_section",
    ]);
  });

  it("reorders sections with accessible controls rather than a drag target", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Move Technical SEO up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await screen.findByRole("heading", { name: "Draft saved" });

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(payload.sections.map((item) => item.section_key)).toEqual([
      "technical_seo",
      "geo_ranking",
    ]);
  });

  it("reveals the link field only when the operator asks for one", () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    expect(screen.queryByPlaceholderText("https://...")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Add link" })[0]!);
    expect(screen.getByPlaceholderText("https://...")).toBeInTheDocument();
  });

  it("keeps a stored link visible on the entry that owns it after a reorder", () => {
    render(
      <ReportBuilder
        document={documentFixture({
          sections: [
            section("site_audits", "Site Audits", [
              { label: "Desktop After", value: null, url: "https://reports.example.invalid/after" },
              { label: "Ranking", value: "Improved from 12 to 4", url: null },
            ]),
          ],
        })}
        canSend
      />,
    );

    expect(screen.getAllByPlaceholderText("https://...")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Move entry 1 in Site Audits down" }));

    // Still exactly one link field, and it is still the one carrying the URL.
    const urlFields = screen.getAllByPlaceholderText("https://...");
    expect(urlFields).toHaveLength(1);
    expect(urlFields[0]).toHaveValue("https://reports.example.invalid/after");
  });

  it("says when there is unsaved work and stops saying it after a save", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.change(screen.getByDisplayValue("August 2026 SEO Report"), {
      target: { value: "August 1-31, 2026" },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("heading", { name: "Draft saved" });
  });

  it("surfaces a rejected save instead of pretending it landed", async () => {
    saveReportDraftAction.mockResolvedValue({ ok: false, error: "Report links must start with http://." });
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("Report links must start with http://.")).toBeInTheDocument();
  });

  it("blocks sending while an entry is unlabelled", () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.change(screen.getByDisplayValue("junk removal"), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Send to client" })).toBeDisabled();
    expect(screen.getByText(/1 thing to fix before sending/u)).toBeInTheDocument();
  });

  it("never sends as a side effect of saving", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("heading", { name: "Draft saved" });

    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("confirms who is about to receive what before sending", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Send to client" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Send this report to Northgate Dental?"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("August 2026 SEO Report")).toBeInTheDocument();
    expect(within(dialog).getByText(/Platinum SEO/u)).toBeInTheDocument();

    expect(sendReportDraftAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await vi.waitFor(() => expect(sendReportDraftAction).toHaveBeenCalledTimes(1));

    // Saved first, so what is on screen is what was delivered.
    expect(saveReportDraftAction).toHaveBeenCalledTimes(1);
  });

  it("lets a cancelled confirmation change nothing", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Send to client" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("hides Send from an actor the resolver did not grant it to", () => {
    render(<ReportBuilder document={documentFixture()} canSend={false} />);
    expect(screen.queryByRole("button", { name: "Send to client" })).not.toBeInTheDocument();
  });

  it("arms a discard before performing it", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(discardReportDraftAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard for good?" }));
    await vi.waitFor(() => expect(discardReportDraftAction).toHaveBeenCalledTimes(1));
  });

  it("opens a sent report read-only, with no editor and no send", () => {
    render(
      <ReportBuilder
        document={documentFixture({ status: "sent", sent_at: "2026-08-18T10:00:00.000Z" })}
        canSend
      />,
    );

    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to client" })).not.toBeInTheDocument();
    expect(
      screen.getByText("This report has been sent and can no longer be edited."),
    ).toBeInTheDocument();
    // The read-only face is the preview itself.
    expect(screen.getByRole("heading", { name: "August 2026 SEO Report" })).toBeInTheDocument();
  });
});

/* ================================================ sent report navigation */

/**
 * A sent report has no editor footer, so without this control the only way out
 * of the detail is a detour through another sidebar page. The destination is
 * the Reporting list rather than browser history, because that is the parent
 * workspace for a report however the operator arrived.
 */
describe("leaving a sent report", () => {
  const sent = () =>
    documentFixture({ status: "sent", sent_at: "2026-08-18T10:00:00.000Z" });

  it("exposes a Back control on a sent, read-only report", () => {
    render(<ReportBuilder document={sent()} canSend />);

    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
  });

  it("points Back at the Reporting list", () => {
    render(<ReportBuilder document={sent()} canSend />);

    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/reporting");
  });

  it("navigates to the Reporting list when Back is activated", () => {
    render(<ReportBuilder document={sent()} canSend />);

    fireEvent.click(screen.getByRole("link", { name: "Back" }));

    expect(routerPush).toHaveBeenCalledWith("/reporting");
  });

  it("leaves the report itself untouched — no save, no send, no discard", () => {
    render(<ReportBuilder document={sent()} canSend />);

    fireEvent.click(screen.getByRole("link", { name: "Back" }));

    expect(saveReportDraftAction).not.toHaveBeenCalled();
    expect(sendReportDraftAction).not.toHaveBeenCalled();
    expect(discardReportDraftAction).not.toHaveBeenCalled();
  });

  it("does not add a second way out to a draft, which still has its footer", () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    expect(screen.queryByRole("link", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
  });
});

/* ================================================ preview */

describe("preview", () => {
  it("shows the client, the period, the package and every ordered section", () => {
    render(
      <ReportPreview
        companyName="Northgate Dental"
        title="August 2026 SEO Report"
        lane="seo_package"
        packageLabel="Platinum SEO"
        sections={[
          section("geo_ranking", "GEO Ranking", [
            { label: "junk removal", value: "RANK 2.12", url: null },
          ]),
          section("blog_posts", "Blog Posts", [
            {
              label: "First article",
              value: "4 posts completed",
              url: "https://reports.example.invalid/blog",
            },
          ]),
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "August 2026 SEO Report" })).toBeInTheDocument();
    expect(screen.getByText("Northgate Dental")).toBeInTheDocument();
    expect(screen.getByText("Platinum SEO")).toBeInTheDocument();
    expect(screen.getByText("SEO Package")).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual(["GEO Ranking", "Blog Posts"]);

    expect(screen.getByText("RANK 2.12")).toBeInTheDocument();
    expect(screen.getByText("4 posts completed")).toBeInTheDocument();
  });

  it("renders a link as a safe named anchor, never as the whole entry", () => {
    render(
      <ReportPreview
        companyName="Northgate Dental"
        title="August 2026"
        lane="seo_package"
        packageLabel="Platinum SEO"
        sections={[
          section("site_audits", "Site Audits", [
            { label: "Desktop After", value: null, url: "https://reports.example.invalid/after" },
          ]),
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: "View" });
    expect(link).toHaveAttribute("href", "https://reports.example.invalid/after");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("refuses to make an unsafe stored link clickable", () => {
    render(
      <ReportPreview
        companyName="Northgate Dental"
        title="August 2026"
        lane="seo_package"
        packageLabel="Platinum SEO"
        sections={[
          section("site_audits", "Site Audits", [
            { label: "Bad asset", value: null, url: "javascript:alert(1)" },
          ]),
        ]}
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("No detail")).toBeInTheDocument();
  });

  it("says plainly when there is nothing for the client to read", () => {
    render(
      <ReportPreview
        companyName="Northgate Dental"
        title="August 2026"
        lane="gmb_management"
        packageLabel="GMB Management"
        sections={[]}
      />,
    );

    expect(
      screen.getByText(
        "This report has no sections yet, so there is nothing for the client to read.",
      ),
    ).toBeInTheDocument();
  });
});

/* ================================================ new report setup */

describe("starting a report", () => {
  const clients = [
    { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", name: "Northgate Dental" },
    { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", name: "Southgate Legal" },
  ];

  it("prefills client, owned Service and reporting month without completing an order", async () => {
    render(<NewReportForm clients={clients} prefill={{ companyId: clients[0]!.id, serviceId: reportingServiceIds.gmbManagement, reportingPeriodMonth: "2026-10-01" }} initialChoices={[{
      serviceId: reportingServiceIds.gmbManagement, serviceName: "GMB/GBP Management", subscriptionId: null, subscriptionStatus: null,
    }]} />);
    expect(screen.getByRole("heading", { name: "Choose the Service" })).toBeInTheDocument();
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(createServiceReportDraftAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start guided report" }));
    await vi.waitFor(() => expect(createServiceReportDraftAction).toHaveBeenCalledWith(expect.objectContaining({
      companyId: clients[0]!.id, serviceId: reportingServiceIds.gmbManagement, reportingPeriodMonth: "2026-10-01",
    })));
  });

  it("creates a November draft from completion prefill even when opened in December", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
    try {
      render(<NewReportForm clients={clients} prefill={{ companyId: clients[0]!.id, serviceId: reportingServiceIds.gmbManagement, reportingPeriodMonth: "2026-11-01" }} initialChoices={[{
        serviceId: reportingServiceIds.gmbManagement, serviceName: "GMB/GBP Management", subscriptionId: null, subscriptionStatus: null,
      }]} />);
      expect(screen.getByText("November 2026")).toBeInTheDocument();
      expect(createServiceReportDraftAction).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Start guided report" }));
      await vi.waitFor(() => expect(createServiceReportDraftAction).toHaveBeenCalledWith(expect.objectContaining({ reportingPeriodMonth: "2026-11-01" })));
    } finally { vi.useRealTimers(); }
  });

  it("starts with one focused client decision", () => {
    render(<NewReportForm clients={clients} />);
    expect(screen.getByRole("heading", { name: "Choose the client" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByText("Choose the Service")).not.toBeInTheDocument();
  });

  it("loads only the selected client's attached supported Services", async () => {
    render(<NewReportForm clients={clients} />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Client" }));
    fireEvent.click(await screen.findByRole("option", { name: "Northgate Dental" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Choose the Service" }))
      .toBeInTheDocument();
    expect(listReportServiceChoicesAction).toHaveBeenCalledWith({ companyId: clients[0]!.id });
    expect(screen.getByRole("button", { name: /Platinum SEO Success Blueprint/u }))
      .toHaveTextContent("active subscription");
    expect(screen.queryByText(/Reporting lane/u)).not.toBeInTheDocument();
  });

  it("selects an attached standalone GMB subscription by stable Service identity", async () => {
    listReportServiceChoicesAction.mockResolvedValueOnce({
      ok: true,
      fallback: false,
      choices: [
        {
          serviceId: reportingServiceIds.gmbManagement,
          serviceName: "GMB/GBP Management",
          subscriptionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3318",
          subscriptionStatus: "active",
        },
      ],
    });
    render(<NewReportForm clients={clients} />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Client" }));
    fireEvent.click(await screen.findByRole("option", { name: "Northgate Dental" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const gmbChoice = await screen.findByRole("button", { name: /GMB\/GBP Management/u });
    expect(gmbChoice).toHaveTextContent("GMB Content · GMB Posting");
    expect(gmbChoice).not.toHaveTextContent("0 blogs");
    fireEvent.click(gmbChoice);
    fireEvent.click(screen.getByRole("button", { name: "Start guided report" }));

    await vi.waitFor(() => expect(createServiceReportDraftAction).toHaveBeenCalledTimes(1));
    expect(createServiceReportDraftAction).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: reportingServiceIds.gmbManagement,
      subscriptionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3318",
    }));
  });

  it("offers an owned order Service without requiring a subscription", async () => {
    listReportServiceChoicesAction.mockResolvedValueOnce({
      ok: true,
      fallback: true,
      choices: [
        {
          serviceId: reportingServiceIds.gmbManagement,
          serviceName: "GMB/GBP Management",
          subscriptionId: null,
          subscriptionStatus: null,
        },
      ],
    });
    render(<NewReportForm clients={clients} />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Client" }));
    fireEvent.click(await screen.findByRole("option", { name: "Southgate Legal" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const fallbackChoice = await screen.findByRole("button", { name: /GMB\/GBP Management/u });
    expect(fallbackChoice).toHaveTextContent("Purchased or in-progress order");
    expect(screen.queryByText(/catalogue|fallback/iu)).not.toBeInTheDocument();

    fireEvent.click(fallbackChoice);
    fireEvent.click(screen.getByRole("button", { name: "Start guided report" }));
    await vi.waitFor(() => expect(createServiceReportDraftAction).toHaveBeenCalledTimes(1));
    expect(createServiceReportDraftAction).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: reportingServiceIds.gmbManagement,
      subscriptionId: null,
    }));
  });

  it("explains when the client has no owned supported Services", async () => {
    listReportServiceChoicesAction.mockResolvedValueOnce({ ok: true, fallback: false, choices: [] });
    render(<NewReportForm clients={clients} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Client" }));
    fireEvent.click(await screen.findByRole("option", { name: "Northgate Dental" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/No purchased or in-progress Reporting Services/iu)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start guided report" })).toBeDisabled();
  });

  it("creates a guided draft from the selected stable Service identity", async () => {
    render(<NewReportForm clients={clients} />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Client" }));
    fireEvent.click(await screen.findByRole("option", { name: "Northgate Dental" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", {
      name: /Platinum SEO Success Blueprint/u,
    }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "August 2026 Platinum SEO Report" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start guided report" }));

    await vi.waitFor(() => expect(createServiceReportDraftAction).toHaveBeenCalledTimes(1));

    const payload = createServiceReportDraftAction.mock.calls[0]![0];

    expect(payload.companyId).toBe(clients[0]!.id);
    expect(payload.serviceId).toBe(reportingServiceIds.platinumSeo100);
    expect(payload.subscriptionId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3399");
    expect(payload.title).toBe("August 2026 Platinum SEO Report");

    expect(createdReportId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(routerPush).toHaveBeenCalledWith(`/reporting/${createdReportId}`);
  });
});

/* ========================================== guided report wizard */

describe("the service-aware report wizard", () => {
  it("initializes fresh SEO and GMB RPC documents at their correct first steps", () => {
    const seoDocument = internalReportDocumentSchema.parse(
      freshServiceAwareRpcDocument(reportingServiceIds.platinumSeo100, "technical_seo"),
    );
    const { unmount } = render(<ReportWizard document={seoDocument} canSend />);

    expect(screen.getByRole("heading", { name: "Technical SEO" })).toBeInTheDocument();
    unmount();

    const gmbDocument = internalReportDocumentSchema.parse(
      freshServiceAwareRpcDocument(reportingServiceIds.gmbManagement, "gmb_content"),
    );
    render(<ReportWizard document={gmbDocument} canSend />);

    expect(screen.getByRole("heading", { name: "GMB Content" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Technical SEO" })).not.toBeInTheDocument();
  });

  it("resumes a freshly read stripped RPC document at its persisted step", () => {
    const resumed = internalReportDocumentSchema.parse(
      freshServiceAwareRpcDocument(reportingServiceIds.platinumSeo100, "performance"),
    );

    render(<ReportWizard document={resumed} canSend />);

    expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
  });

  it("runs standalone GMB through Content, Posting, Custom additions, and Review only", async () => {
    render(<ReportWizard document={gmbWizardDocument()} canSend />);

    expect(screen.getByRole("heading", { name: "GMB Content" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Technical SEO" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Performance" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("GMB Content"), {
      target: { value: "https://reports.example.invalid/gmb-content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "GMB Posting" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Custom additions" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Review report" })).toBeInTheDocument();
    expect(screen.getByText("GMB Management")).toBeInTheDocument();
    expect(screen.getAllByText("GMB/GBP Management").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GMB Content").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GMB Posting").length).toBeGreaterThan(0);
  });

  it("shows one focused step and preserves data when going Back", async () => {
    render(<ReportWizard document={wizardDocument()} canSend />);

    expect(screen.getByRole("heading", { name: "Technical SEO" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Desktop Before URL")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Site Audit Before"), {
      target: { value: "https://reports.example.invalid/audit-before" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("heading", { name: "Performance" }))
      .toBeInTheDocument();
    expect(saveReportDraftAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ wizardStepKey: "performance" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("Site Audit Before"))
      .toHaveValue("https://reports.example.invalid/audit-before");
    expect(saveReportDraftAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ wizardStepKey: "technical_seo" }),
    );
  });

  it("selects one blog count and shares it with Blog Posts and YouTube Stack", async () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);

    expect(screen.getByText("How many blogs were completed?")).toBeInTheDocument();
    expect(screen.getByText("Expected this cycle: 4 Blogs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("heading", { name: "YouTube Stack" })).toBeInTheDocument();

    // The YouTube step shows the derived count and never asks for a second entry.
    expect(screen.getByText("Based on 4 completed blogs this cycle.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByLabelText("YouTube Stack asset URL")).toBeInTheDocument();

    // Both entries carried the same actual count to the saved draft.
    const payload = saveReportDraftAction.mock.calls.at(-1)![0];
    expect(
      payload.sections
        .find((item) => item.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts"),
    ).toEqual(expect.objectContaining({ value: "4 Blogs Posted" }));
    expect(
      payload.sections.find((item) => item.section_key === "youtube_stack")?.entries[0],
    ).toEqual(expect.objectContaining({ value: "4 YouTube Stacks" }));
  });

  it("re-derives the YouTube count when the blog count changes on Back", async () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);

    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "YouTube Stack" });
    expect(screen.getByText("Based on 4 completed blogs this cycle.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const blogFour = await screen.findByRole("radio", { name: "4" });
    expect(blogFour).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("heading", { name: "YouTube Stack" })).toBeInTheDocument();
    expect(screen.getByText("Based on 3 completed blogs this cycle.")).toBeInTheDocument();
    expect(screen.queryByText("Based on 4 completed blogs this cycle.")).not.toBeInTheDocument();
  });

  it("persists the blog count as the shared count so a resumed draft resolves", async () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);

    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(1));

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(
      payload.sections
        .find((item) => item.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts"),
    ).toEqual(expect.objectContaining({ value: "3 Blogs Posted" }));
    expect(
      payload.sections.find((item) => item.section_key === "youtube_stack")?.entries[0],
    ).toEqual(expect.objectContaining({ value: "3 YouTube Stacks" }));
  });

  it("resumes a saved draft with Blog Posts and YouTube Stack both resolved to the blog count", async () => {
    render(
      <ReportWizard
        document={wizardDocumentWithBlogCount(3, { wizard_step_key: "youtube_stack" })}
        canSend
      />,
    );

    expect(await screen.findByRole("heading", { name: "YouTube Stack" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Based on 3 completed blogs this cycle.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("does not persist the expected quantity merely by rendering", async () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);

    // Platinum expects 4 blogs. The chip is selected, but rendering writes nothing.
    expect(screen.getByRole("radio", { name: "4" })).toBeChecked();
    expect(saveReportDraftAction).not.toHaveBeenCalled();

    // Next confirms the visible selection and persists it.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "YouTube Stack" });
    expect(saveReportDraftAction).toHaveBeenCalledTimes(1);

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(
      payload.sections
        .find((item) => item.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts"),
    ).toEqual(expect.objectContaining({ value: "4 Blogs Posted" }));
  });

  it("keeps the Podcast count independently entered", async () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "podcast_stack" })} canSend />);

    // Podcast still asks for its own completed quantity, with its own chips.
    expect(screen.getByText("How many Podcast Stacks were completed?")).toBeInTheDocument();
    expect(screen.getByText("Expected this cycle: 4 Podcast Stacks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(1));

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(
      payload.sections.find((item) => item.section_key === "podcast_stack")?.entries[0],
    ).toEqual(expect.objectContaining({ value: "2 Podcast Stacks completed" }));
    expect(
      payload.sections
        .find((item) => item.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts")?.value,
    ).toBeNull();
  });

  it("defaults each package to its own expected blog quantity", () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);
    expect(screen.getByRole("radio", { name: "4" })).toBeChecked();

    cleanup();

    render(
      <ReportWizard
        document={wizardDocumentForProfile(reportingServiceIds.foundationalSeo20)}
        canSend
      />,
    );
    expect(screen.getByRole("radio", { name: "2" })).toBeChecked();

    cleanup();

    render(
      <ReportWizard
        document={wizardDocumentForProfile(reportingServiceIds.starterSeo)}
        canSend
      />,
    );
    expect(screen.getByRole("radio", { name: "1" })).toBeChecked();
  });

  it("accepts a custom nonnegative whole-number count", async () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);

    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const custom = screen.getByLabelText("Custom completed count");
    fireEvent.change(custom, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(1));

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(
      payload.sections
        .find((item) => item.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts"),
    ).toEqual(expect.objectContaining({ value: "7 Blogs Posted" }));
    expect(
      payload.sections.find((item) => item.section_key === "youtube_stack")?.entries[0],
    ).toEqual(expect.objectContaining({ value: "7 YouTube Stacks" }));
  });

  it("rejects words, decimals and negatives in the custom count", () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);

    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const custom = screen.getByLabelText("Custom completed count");

    // Opening Custom prefills the previous selection; every invalid edit is refused.
    expect(custom).toHaveValue("4");
    fireEvent.change(custom, { target: { value: "3.5" } });
    expect(custom).toHaveValue("4");
    fireEvent.change(custom, { target: { value: "abc" } });
    expect(custom).toHaveValue("4");
    fireEvent.change(custom, { target: { value: "-3" } });
    expect(custom).toHaveValue("4");
    expect(screen.getByText("Whole numbers only.")).toBeInTheDocument();
  });

  it("reaches zero through Custom when no zero chip is offered", async () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "blog_content" })} canSend />);

    // Platinum offers [4 3 2 1 Custom]; zero is reachable through Custom.
    expect(screen.queryByRole("radio", { name: "0" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const custom = screen.getByLabelText("Custom completed count");
    fireEvent.change(custom, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(1));

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(
      payload.sections
        .find((item) => item.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts"),
    ).toEqual(expect.objectContaining({ value: "0 Blogs Posted" }));
  });

  it("offers a zero chip directly when nothing completed is a realistic neighbour", async () => {
    render(
      <ReportWizard
        document={wizardDocumentForProfile(reportingServiceIds.foundationalSeo20)}
        canSend
      />,
    );

    // Foundational expects 2, so [2 1 0 Custom] includes a zero chip.
    fireEvent.click(screen.getByRole("radio", { name: "0" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(1));

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(
      payload.sections
        .find((item) => item.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts"),
    ).toEqual(expect.objectContaining({ value: "0 Blogs Posted" }));
  });

  it("resumes a saved custom count in Custom mode", () => {
    render(
      <ReportWizard
        document={wizardDocumentWithBlogCount(7, { wizard_step_key: "blog_content" })}
        canSend
      />,
    );

    expect(screen.getByRole("radio", { name: "Custom" })).toBeChecked();
    expect(screen.getByLabelText("Custom completed count")).toHaveValue("7");
  });

  it("resumes a saved quick-selected blog count on the chip", () => {
    render(
      <ReportWizard
        document={wizardDocumentWithBlogCount(3, { wizard_step_key: "blog_content" })}
        canSend
      />,
    );

    expect(screen.getByRole("radio", { name: "3" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "4" })).not.toBeChecked();
  });

  it("generates one explicit Press Release URL slot per expected delivery", () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "press_releases" })} canSend />);

    expect(screen.getByLabelText("Press Release 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Press Release 4")).toBeInTheDocument();
    expect(screen.queryByLabelText("Press Release 5")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add another link" }));
    expect(screen.getByLabelText("Press Release 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Press Release 5" }));
    expect(screen.queryByLabelText("Press Release 5")).not.toBeInTheDocument();
  });

  it("always offers a custom report item outside the fixed profile", () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "custom_additions" })} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Add report item" }));
    expect(screen.getByLabelText("Report item")).toBeInTheDocument();
    expect(screen.getByLabelText("Value or status")).toBeInTheDocument();
    expect(screen.getByLabelText("Supporting URL (optional)")).toBeInTheDocument();
  });

  /* ---------------------------------------------- wizard context header */

  /**
   * The header carries two context zones: who the report is for and what it
   * covers on the left, where the operator is in the run on the right. How the
   * profile was resolved — an attached subscription or the service catalogue —
   * is an implementation detail that never changes what William does here.
   */
  it("names the client in the wizard header", () => {
    const { container } = render(<ReportWizard document={wizardDocument()} canSend />);

    const header = container.querySelector("header")!;
    expect(within(header).getByText("Client")).toBeInTheDocument();
    expect(within(header).getByText("Northgate Dental")).toBeInTheDocument();
  });

  it("names the service beneath the client rather than beside it", () => {
    const { container } = render(<ReportWizard document={wizardDocument()} canSend />);

    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(
      screen.getByText("Platinum SEO Success Blueprint (100 Targeted Keywords)"),
    ).toBeInTheDocument();

    // Service follows client in document order, so it reads as the weaker line.
    const labels = Array.from(container.querySelectorAll("header span")).map(
      (node) => node.textContent,
    );
    expect(labels.indexOf("Client")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Service")).toBeGreaterThan(labels.indexOf("Client"));
  });

  it("never shows catalogue fallback plumbing to the operator", () => {
    const { unmount } = render(<ReportWizard document={wizardDocument()} canSend />);
    expect(screen.queryByText("Catalogue profile fallback")).not.toBeInTheDocument();
    // The affirmative case is still worth stating.
    expect(screen.getByText("Attached subscription")).toBeInTheDocument();
    unmount();

    // The fallback case itself: no attached subscription, still no plumbing.
    render(<ReportWizard document={wizardDocument({ subscription_id: null })} canSend />);
    expect(screen.queryByText("Catalogue profile fallback")).not.toBeInTheDocument();
    expect(screen.queryByText("Attached subscription")).not.toBeInTheDocument();
    // The service resolved regardless, which is the behaviour that matters.
    expect(
      screen.getByText("Platinum SEO Success Blueprint (100 Targeted Keywords)"),
    ).toBeInTheDocument();
  });

  it("keeps the active step and its progress together in the header", async () => {
    const { container } = render(
      <ReportWizard
        document={internalReportDocumentSchema.parse(
          freshServiceAwareRpcDocument(reportingServiceIds.platinumSeo100, "technical_seo"),
        )}
        canSend
      />,
    );

    expect(screen.getByText("Step 1 of 10")).toBeInTheDocument();
    // The active step is named in the header, not only as the step heading.
    const header = container.querySelector("header")!;
    expect(within(header).getByText("Technical SEO")).toBeInTheDocument();

    const fill = () => header.querySelector<HTMLElement>("span[style]")!;
    expect(fill().style.width).toBe("10%");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Performance" });

    expect(screen.getByText("Step 2 of 10")).toBeInTheDocument();
    expect(within(header).getByText("Performance")).toBeInTheDocument();
    expect(fill().style.width).toBe("20%");
  });

  it("keeps the Phase 2 advanced editor directly available", () => {
    render(<ReportWizard document={wizardDocument()} canSend />);
    expect(screen.getByRole("link", { name: "Advanced edit" }))
      .toHaveAttribute("href", `/reporting/${wizardDocument().report_id}?mode=advanced`);
  });
});

describe("one-time setup — local editing never leaves the step", () => {
  const oneTimeDocument = () => wizardDocument({ wizard_step_key: "one_time_setup" });

  it("typing into Status or value only updates the wizard's local state", () => {
    render(<ReportWizard document={oneTimeDocument()} canSend />);

    const status = screen.getAllByLabelText("Status or value")[0]!;
    fireEvent.change(status, { target: { value: "Completed" } });

    expect(status).toHaveValue("Completed");
    expect(screen.getByRole("heading", { name: "One-time Setup" })).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    // No navigation, no save, no send, no durable completion consumption.
    expect(saveReportDraftAction).not.toHaveBeenCalled();
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("typing a supporting URL only updates the wizard's local state", () => {
    render(<ReportWizard document={oneTimeDocument()} canSend />);

    const url = screen.getAllByLabelText("Supporting URL (optional)")[0]!;
    fireEvent.change(url, { target: { value: "https://example.invalid/asset" } });

    expect(url).toHaveValue("https://example.invalid/asset");
    expect(screen.getByRole("heading", { name: "One-time Setup" })).toBeInTheDocument();
    expect(saveReportDraftAction).not.toHaveBeenCalled();
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("toggling Completed and reported in this cycle only updates the wizard's local state", () => {
    render(<ReportWizard document={oneTimeDocument()} canSend />);

    // Evidence is required before the completion flag is offered.
    fireEvent.change(screen.getAllByLabelText("Supporting URL (optional)")[0]!, {
      target: { value: "https://example.invalid/asset" },
    });
    const check = screen.getAllByRole("checkbox", {
      name: /Completed and reported in this cycle/,
    })[0]!;
    fireEvent.click(check);

    expect(check).toBeChecked();
    expect(screen.getByRole("heading", { name: "One-time Setup" })).toBeInTheDocument();
    expect(saveReportDraftAction).not.toHaveBeenCalled();
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("custom additions typing never reads the event inside the state updater", () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "custom_additions" })} canSend />);
    fireEvent.click(screen.getByRole("button", { name: "Add report item" }));

    const label = screen.getByLabelText("Report item");
    fireEvent.change(label, { target: { value: "Custom deliverable" } });
    const value = screen.getByLabelText("Value or status");
    fireEvent.change(value, { target: { value: "Completed" } });
    const url = screen.getByLabelText("Supporting URL (optional)");
    fireEvent.change(url, { target: { value: "https://example.invalid/asset" } });

    expect(label).toHaveValue("Custom deliverable");
    expect(value).toHaveValue("Completed");
    expect(url).toHaveValue("https://example.invalid/asset");
    expect(screen.getByRole("heading", { name: "Custom additions" })).toBeInTheDocument();
    expect(saveReportDraftAction).not.toHaveBeenCalled();
  });

  it("custom section titles can be renamed without leaving the step", () => {
    render(<ReportWizard document={wizardDocument({ wizard_step_key: "custom_additions" })} canSend />);
    fireEvent.click(screen.getByRole("button", { name: "Add report item" }));
    fireEvent.click(screen.getByRole("button", { name: "Add custom section" }));

    const titles = screen.getAllByLabelText("Custom section");
    fireEvent.change(titles.at(-1)!, { target: { value: "Renamed section" } });

    expect(screen.getByDisplayValue("Renamed section")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Custom additions" })).toBeInTheDocument();
  });
});

describe("skip one-time setup", () => {
  const oneTimeDocument = () => wizardDocument({ wizard_step_key: "one_time_setup" });

  it("offers Skip One-time Setup only on the one-time step", () => {
    const { unmount } = render(<ReportWizard document={wizardDocument()} canSend />);
    expect(screen.queryByRole("button", { name: "Skip One-time Setup" })).not.toBeInTheDocument();
    unmount();

    render(<ReportWizard document={oneTimeDocument()} canSend />);
    expect(screen.getByRole("button", { name: "Skip One-time Setup" })).toBeInTheDocument();
  });

  it("skip moves to the next applicable step and saves the cleared document", async () => {
    render(<ReportWizard document={oneTimeDocument()} canSend />);

    // Type draft-only evidence, then skip: none of it may reach the saved
    // document, and nothing durable is consumed.
    fireEvent.change(screen.getAllByLabelText("Status or value")[0]!, {
      target: { value: "Completed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip One-time Setup" }));

    expect(await screen.findByRole("heading", { name: "Custom additions" }))
      .toBeInTheDocument();
    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(1));

    const payload = saveReportDraftAction.mock.calls[0]![0];
    expect(payload.wizardStepKey).toBe("custom_additions");
    const oneTime = payload.sections.find((item) => item.section_key === "one_time_setup")!;
    expect(oneTime.entries).toHaveLength(3);
    for (const entry of oneTime.entries) {
      expect(entry.value).toBeNull();
      expect(entry.url).toBeNull();
      expect(entry.one_time_completed).toBe(false);
      expect(entry.one_time_item_key).toBeTruthy();
    }
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("skip then Back returns to One-time Setup and filling normally still works", async () => {
    render(<ReportWizard document={oneTimeDocument()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Skip One-time Setup" }));
    expect(await screen.findByRole("heading", { name: "Custom additions" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "One-time Setup" }))
      .toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText("Status or value")[0]!, {
      target: { value: "Completed" },
    });
    fireEvent.change(screen.getAllByLabelText("Supporting URL (optional)")[0]!, {
      target: { value: "https://example.invalid/asset" },
    });
    fireEvent.click(screen.getAllByRole("checkbox", {
      name: /Completed and reported in this cycle/,
    })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(3));

    const payload = saveReportDraftAction.mock.calls[2]![0];
    expect(payload.wizardStepKey).toBe("one_time_setup");
    expect(
      payload.sections
        .find((item) => item.section_key === "one_time_setup")!
        .entries[0],
    ).toEqual(expect.objectContaining({
      value: "Completed",
      url: "https://example.invalid/asset",
      one_time_completed: true,
    }));
    // Saving a draft consumes nothing durable.
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("a skipped one-time step is dropped from the document saved before send", async () => {
    render(<ReportWizard document={oneTimeDocument()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Skip One-time Setup" }));
    expect(await screen.findByRole("heading", { name: "Custom additions" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Review report" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send to client" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await vi.waitFor(() => expect(sendReportDraftAction).toHaveBeenCalledTimes(1));
    const lastSave = saveReportDraftAction.mock.calls.at(-1)![0];
    expect(lastSave.sections.find((item) => item.section_key === "one_time_setup"))
      .toBeUndefined();
    expect(lastSave.sections.length).toBeGreaterThan(0);
  });

  it("a completed one-time step is kept in the document saved before send", async () => {
    const completed = oneTimeDocument();
    completed.sections = completed.sections.map((section) =>
      section.section_key === "one_time_setup"
        ? {
            ...section,
            entries: section.entries.map((entry, index) =>
              index === 0
                ? {
                    ...entry,
                    value: "Completed",
                    url: "https://example.invalid/asset",
                    one_time_completed: true,
                  }
                : entry,
            ),
          }
        : section,
    );
    render(<ReportWizard document={completed} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Custom additions" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Review report" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send to client" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await vi.waitFor(() => expect(sendReportDraftAction).toHaveBeenCalledTimes(1));
    const lastSave = saveReportDraftAction.mock.calls.at(-1)![0];
    const oneTime = lastSave.sections.find((item) => item.section_key === "one_time_setup")!;
    expect(oneTime.entries[0]).toEqual(expect.objectContaining({
      value: "Completed",
      url: "https://example.invalid/asset",
      one_time_completed: true,
    }));
  });

  it("a failed send leaves the draft unchanged", async () => {
    sendReportDraftAction.mockResolvedValueOnce({ ok: false, error: "Send failed" });
    render(<ReportWizard document={oneTimeDocument()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Skip One-time Setup" }));
    expect(await screen.findByRole("heading", { name: "Custom additions" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Review report" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send to client" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await vi.waitFor(() => expect(sendReportDraftAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Send failed")).toBeInTheDocument();

    // The final save restored the full document, one-time section included.
    const lastSave = saveReportDraftAction.mock.calls.at(-1)![0];
    expect(lastSave.sections.find((item) => item.section_key === "one_time_setup"))
      .toBeDefined();
  });
});

/* ============================================ save + send completion flow */

describe("save + send completion flow", () => {
  /** A Platinum wizard draft opened directly at the Review step. */
  const reviewWizard = () => wizardDocument({ wizard_step_key: "review" });

  async function openSendConfirmation() {
    fireEvent.click(screen.getByRole("button", { name: "Send to client" }));
    return screen.getByRole("dialog");
  }

  /* --- save draft --- */

  it("save draft calls the existing save action once", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await vi.waitFor(() => expect(saveReportDraftAction).toHaveBeenCalledTimes(1));
  });

  it("a successful save shows the Draft saved face", async () => {
    render(<ReportWizard document={wizardDocument()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("heading", { name: "Draft saved" })).toBeInTheDocument();
    expect(screen.getByText("Your report is ready to continue later.")).toBeInTheDocument();
  });

  it("a successful save navigates to the Reporting list", async () => {
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    // The face navigates by clicking a hidden Link, which pushes with a
    // scroll option — assert the destination, not the exact call signature.
    await vi.waitFor(() => expect(routerPush).toHaveBeenCalled(), { timeout: 3000 });
    expect(routerPush.mock.calls[0]![0]).toBe("/reporting");
  });

  it("a failed save stays on the page and does not navigate", async () => {
    saveReportDraftAction.mockResolvedValue({
      ok: false,
      error: "Report links must start with http://.",
    });
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("Report links must start with http://."))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Draft saved" })).not.toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("blocks a repeated save click while saving", async () => {
    let releaseSave: ((result: ActionResult) => void) | undefined;
    saveReportDraftAction.mockImplementation(
      () => new Promise<ActionResult>((resolve) => { releaseSave = resolve; }),
    );
    render(<ReportBuilder document={documentFixture()} canSend />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(saveReportDraftAction).toHaveBeenCalledTimes(1);
    releaseSave?.({ ok: true });
  });

  /* --- send confirmation --- */

  it("send to client opens a dialog restating the recipient", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();

    expect(
      within(dialog).getByText("Send this report to Northgate Dental?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("The client will receive this report in their portal."),
    ).toBeInTheDocument();
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("renders the confirmation through a body portal, outside the report page", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();

    // The overlay is a direct child of <body>; nothing in the report page —
    // scroll position, a wrapper, a transform — can contain its fixed
    // positioning (the D-055 rule).
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancel closes the dialog without sending", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("escape closes the dialog without sending", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    await openSendConfirmation();
    fireEvent.keyDown(document, { key: "Escape" });

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sendReportDraftAction).not.toHaveBeenCalled();
  });

  it("focuses the safe action on open and returns focus on close", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    const sendTrigger = screen.getByRole("button", { name: "Send to client" });
    // A real pointer press focuses the trigger before the dialog opens; jsdom
    // does not move focus on fireEvent.click, so it is simulated explicitly.
    sendTrigger.focus();
    const dialog = await openSendConfirmation();

    // Cancel is focused, never Send: one Enter must not deliver the report.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sendTrigger).toHaveFocus();
  });

  it("locks body scroll while the confirmation is open", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    await openSendConfirmation();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The restore runs in the same commit as the unmount; wait for it rather
    // than asserting on the same tick the dialog leaves the DOM.
    await vi.waitFor(() => expect(document.body.style.overflow).toBe(""));
  });

  /* --- send --- */

  it("confirm send calls the existing send action once", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    await vi.waitFor(() => expect(sendReportDraftAction).toHaveBeenCalledTimes(1));
  });

  it("disables the actions and shows the sending state while sending", async () => {
    sendReportDraftAction.mockImplementation(() => new Promise<ActionResult>(() => {}));
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    expect(
      await within(screen.getByRole("dialog")).findByRole("button", { name: "Sending…" }),
    ).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }))
      .toBeDisabled();
  });

  it("a duplicate send click does not create a duplicate request", async () => {
    sendReportDraftAction.mockImplementation(() => new Promise<ActionResult>(() => {}));
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();
    // Both clicks land on the same element reference: the label flips to
    // "Sending…" after the first one, so a fresh query would miss the button.
    const sendButton = within(dialog).getByRole("button", { name: "Send report" });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await vi.waitFor(() => expect(sendReportDraftAction).toHaveBeenCalledTimes(1));
  });

  it("a successful send shows the delivery outro", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    expect(
      await screen.findByRole("heading", { name: "Report delivered to client" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Northgate Dental can now view the report in their Wolf Forge portal."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Returning to Reporting/u)).toBeInTheDocument();
  });

  it("a successful send navigates to the Reporting list", async () => {
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    // The outro navigates by clicking a hidden Link, which pushes with a
    // scroll option — assert the destination, not the exact call signature.
    await vi.waitFor(() => expect(routerPush).toHaveBeenCalled(), { timeout: 4000 });
    expect(routerPush.mock.calls[0]![0]).toBe("/reporting");
  });

  it("a failed send stays on the editor with the error and no success face", async () => {
    sendReportDraftAction.mockResolvedValue({ ok: false, error: "Send failed" });
    render(<ReportWizard document={reviewWizard()} canSend />);

    const dialog = await openSendConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Send failed")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(
      screen.queryByRole("heading", { name: "Report delivered to client" }),
    ).not.toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
    // The editor is still there, still editable.
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to client" })).toBeInTheDocument();
  });
});

describe("reporting actions during a minimized call",()=>{
 it.each(["builder","wizard"] as const)("keeps the floating call clear of the %s sticky actions",mode=>{
  vi.stubGlobal("innerWidth",390);vi.stubGlobal("innerHeight",844);
  render(mode==="builder"?<ReportBuilder document={documentFixture()} canSend/>:<ReportWizard document={wizardDocument()} canSend/>);
  const save=screen.getByRole("button",{name:"Save draft"});const bar=mode==="builder"?save.parentElement!:save.closest("footer")!;
  const box=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top,toJSON(){}});
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){
   if(this===bar)return box(0,700,390,100);
   if(this.getAttribute("role")==="region")return box(Number.parseFloat(this.style.left)||0,Number.parseFloat(this.style.top)||0,272,257);
   return box(0,0,0,0);
  });
  render(<FloatingCallWindow visible name="Synthetic client" clock="3:00" micOn busy={false} onMute={vi.fn()} onEnd={vi.fn()} onExpand={vi.fn()}><span>Participant preview</span></FloatingCallWindow>);
  const frame=screen.getByRole("region",{name:"Floating video call"});
  expect(Number.parseFloat(frame.style.top)+257).toBeLessThanOrEqual(688);
  expect(save).toBeVisible();expect(save).toBeEnabled();
 });
});
