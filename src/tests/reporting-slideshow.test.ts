import { describe, expect, it } from "vitest";
import type {
  ClientReportDocument,
  ReportDraftEntryInput,
  ReportDraftSectionInput,
} from "../domain/reporting/schema";
import {
  buildReportSlides,
  oneTimeSlideOrder,
  recurringSlideOrder,
} from "../domain/reporting/slideshow";

function entry(
  label: string,
  value: string | null = null,
  url: string | null = null,
): ReportDraftEntryInput {
  return { label, value, url };
}

function section(
  section_key: string,
  title: string,
  entries: ReportDraftEntryInput[],
): ReportDraftSectionInput {
  return { section_key, title, entries };
}

function report(sections: ClientReportDocument["sections"] = []): ClientReportDocument {
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
    sections,
  };
}

const recurring = (slides: ReturnType<typeof buildReportSlides>) =>
  slides.filter((slide) => slide.kind === "recurring");

const oneTime = (slides: ReturnType<typeof buildReportSlides>) =>
  slides.filter((slide) => slide.kind === "one_time");

describe("buildReportSlides", () => {
  it("always bookends the deck with a cover and a closing slide", () => {
    const slides = buildReportSlides(report());

    expect(slides.map((slide) => slide.kind)).toEqual(["cover", "closing"]);
    expect(slides[0]!.title).toBe("August 2026 SEO Report");
    expect(slides[0]!.cover).toMatchObject({
      companyName: "Northgate Dental",
      packageLabel: "Platinum SEO",
      laneLabel: "SEO Package",
    });
    expect(slides[0]!.cover!.sentLabel).toContain("2026");
    expect(slides.at(-1)!.kind).toBe("closing");
  });

  it("orders recurring topics in the stable order when present", () => {
    const slides = buildReportSlides(
      report([
        section("youtube_stack", "YouTube Stack", [entry("YouTube Stacks", "3 videos")]),
        section("technical_seo", "Technical SEO", [entry("Crawl errors", "0 found")]),
        section("performance", "Performance", [entry("Desktop After", "92")]),
      ]),
    );

    expect(recurring(slides).map((slide) => slide.key)).toEqual([
      "recurring-technical_seo",
      "recurring-performance",
      "recurring-youtube_stack",
    ]);
  });

  it("follows the canonical recurring order for a full set of sections", () => {
    const slides = buildReportSlides(
      report([
        section("gmb_posting", "GMB Posting", [entry("GMB Posting", "5 posts")]),
        section("blog_posts", "Blog Posts", [entry("Blog Posts", "4 posts")]),
        section("blog_content", "Blog Content", [entry("Blog Content", "2 articles")]),
        section("podcast_stack", "Podcast Stack", [entry("Podcast Stacks", "2")]),
        section("press_releases", "Press Releases", [entry("Press Release 1", "done")]),
        section("gmb_content", "GMB Content", [entry("GMB Content", "post")]),
        section("technical_seo", "Technical SEO", [entry("Site Audit After", "0 issues")]),
        section("performance", "Performance", [entry("Mobile After", "95")]),
        section("youtube_stack", "YouTube Stack", [entry("YouTube Stacks", "3")]),
      ]),
    );

    expect(recurring(slides).map((slide) => slide.key)).toEqual(
      recurringSlideOrder.map((topic) => `recurring-${topic}`),
    );
  });

  it("skips recurring topics absent from the report", () => {
    const slides = buildReportSlides(
      report([section("press_releases", "Press Releases", [entry("Press Release 1", "done")])]),
    );

    expect(recurring(slides).map((slide) => slide.key)).toEqual(["recurring-press_releases"]);
  });

  it("shows no one-time slides when the report data contains none", () => {
    const slides = buildReportSlides(
      report([section("technical_seo", "Technical SEO", [entry("Audit", "done")])]),
    );

    expect(oneTime(slides)).toHaveLength(0);
  });

  it("omits an outstanding one-time placeholder with no reportable content", () => {
    const slides = buildReportSlides(
      report([
        section("one_time_setup", "One-time Setup", [
          {
            label: "100 Citations",
            value: null,
            url: null,
            one_time_item_key: "citations_100",
            one_time_completed: false,
          },
        ]),
      ]),
    );

    expect(oneTime(slides)).toHaveLength(0);
    expect(slides.map((slide) => slide.kind)).toEqual(["cover", "closing"]);
  });

  it("shows one-time setup entries only when present, in the stable order", () => {
    const slides = buildReportSlides(
      report([
        section("one_time_setup", "One-time Setup", [
          {
            label: "100 Citations",
            value: "complete",
            url: null,
            one_time_item_key: "citations_100",
            one_time_completed: true,
          },
          {
            label: "One-time GMB Optimization",
            value: "done",
            url: null,
            one_time_item_key: "gmb_optimization",
          },
        ]),
      ]),
    );

    expect(oneTime(slides).map((slide) => slide.title)).toEqual([
      "One-time GMB Optimization",
      "100 Citations",
    ]);
  });

  it("recognises legacy one-time sections (Citations, Directory Listings, Gstack)", () => {
    const slides = buildReportSlides(
      report([
        section("directory_listings", "Directory Listings", [entry("Listings", "100 submitted")]),
        section("citations", "Citations", [entry("Citations", "100 done")]),
        section("advance_gstack", "Advance GStack", [entry("Gstack", "complete")]),
      ]),
    );

    expect(oneTime(slides).map((slide) => slide.title)).toEqual([
      "100 Directory Listings",
      "100 Citations",
      "Advanced Gstack",
    ]);
  });

  it("orders the full one-time catalogue exactly as declared", () => {
    const slides = buildReportSlides(
      report([
        section("one_time_setup", "One-time Setup", [
          ...oneTimeSlideOrder.map((key, index) => ({
            label: `Item ${index}`,
            value: "done",
            url: null as string | null,
            one_time_item_key: key,
          })),
        ]),
      ]),
    );

    expect(oneTime(slides).map((slide) => slide.key)).toEqual(
      oneTimeSlideOrder.map((key) => `one-time-${key}`),
    );
  });

  it("pairs before/after entries into a single transformation", () => {
    const slides = buildReportSlides(
      report([
        section("technical_seo", "Technical SEO", [
          entry("Site Audit Before", "200 issues"),
          entry("Site Audit After", "0 issues"),
        ]),
      ]),
    );

    const slide = recurring(slides)[0]!;
    expect(slide.entries).toEqual([
      expect.objectContaining({
        label: "Site Audit Before",
        pairRole: "before",
        pairBase: "Site Audit",
        value: "200 issues",
      }),
      expect.objectContaining({
        label: "Site Audit After",
        pairRole: "after",
        pairBase: "Site Audit",
        value: "0 issues",
      }),
    ]);
    expect(new Set(slide.entries.map((entry) => entry.pairKey)).size).toBe(1);
  });

  it("keeps non-paired entries as plain rows", () => {
    const slides = buildReportSlides(
      report([
        section("technical_seo", "Technical SEO", [
          entry("Crawl errors", "0 found"),
          entry("Site Audit Before", "200 issues"),
          entry("Site Audit After", "0 issues"),
        ]),
      ]),
    );

    const slide = recurring(slides)[0]!;
    const crawlErrors = slide.entries.find((entry) => entry.label === "Crawl errors")!;
    expect(crawlErrors.pairKey).toBeNull();
    expect(crawlErrors.pairRole).toBeNull();
  });

  it("drops unsafe asset URLs at shape time", () => {
    const slides = buildReportSlides(
      report([
        section("blog_posts", "Blog Posts", [
          entry("Blog Posts", "4 posts", "javascript:alert(1)"),
        ]),
      ]),
    );

    expect(recurring(slides)[0]!.entries[0]!.url).toBeNull();
  });

  it("keeps a safe asset URL for a clean CTA", () => {
    const slides = buildReportSlides(
      report([
        section("blog_posts", "Blog Posts", [
          entry("Blog Posts", "4 posts", "https://reports.example.invalid/blog"),
        ]),
      ]),
    );

    expect(recurring(slides)[0]!.entries[0]!.url).toBe(
      "https://reports.example.invalid/blog",
    );
  });

  it("splits a combined Blog Content / Blog Posts section into two slides", () => {
    const slides = buildReportSlides(
      report([
        {
          section_key: "blog_content",
          title: "Blog Content / Blog Posts",
          entries: [
            entry("Blog Content", null, "https://reports.example.invalid/content"),
            entry("Blog Posts", "4 posts completed"),
          ],
        },
      ]),
    );

    expect(
      recurring(slides).map((slide) => ({
        key: slide.key,
        titles: slide.entries.map((entry) => entry.label),
      })),
    ).toEqual([
      { key: "recurring-blog_content", titles: ["Blog Content"] },
      { key: "recurring-blog_posts", titles: ["Blog Posts"] },
    ]);
  });

  it("distributes GMB Management entries into GMB Content and GMB Posting slides", () => {
    const slides = buildReportSlides(
      report([
        {
          section_key: "gmb_management",
          title: "GMB Management",
          entries: [entry("GMB Content", "New post published"), entry("GMB Posting", "5 posts")],
        },
      ]),
    );

    expect(
      recurring(slides).map((slide) => ({
        key: slide.key,
        titles: slide.entries.map((entry) => entry.label),
      })),
    ).toEqual([
      { key: "recurring-gmb_content", titles: ["GMB Content"] },
      { key: "recurring-gmb_posting", titles: ["GMB Posting"] },
    ]);
  });

  it("keeps unknown sections as generic slides rather than dropping them", () => {
    const slides = buildReportSlides(
      report([section("client_wins", "Client Wins", [entry("Qualified leads", "18")])]),
    );

    const generic = slides.find((slide) => slide.kind === "section");
    expect(generic?.title).toBe("Client Wins");
    expect(generic?.entries[0]).toMatchObject({ label: "Qualified leads", value: "18" });
  });

  it("keeps recurring, one-time, custom, and closing slides in report order", () => {
    const slides = buildReportSlides(
      report([
        section("technical_seo", "Technical SEO", [entry("Site Audit After", "Complete")]),
        section("one_time_setup", "One-time Setup", [
          {
            label: "100 Citations",
            value: "Completed",
            url: null,
            one_time_item_key: "citations_100",
            one_time_completed: true,
          },
        ]),
        section("client_wins", "Client Wins", [entry("Qualified leads", "18")]),
      ]),
    );

    expect(slides.map((slide) => slide.kind)).toEqual([
      "cover",
      "recurring",
      "one_time",
      "section",
      "closing",
    ]);
  });

  it("presents a standalone GMB report without SEO slides", () => {
    const slides = buildReportSlides(
      report([
        section("gmb_content", "GMB Content", [
          entry("GMB Content", null, "https://reports.example.invalid/gmb-content"),
        ]),
        section("gmb_posting", "GMB Posting", [
          entry("GMB Posting", null, "https://reports.example.invalid/gmb-posting"),
        ]),
        section("client_note", "Client Note", [entry("Status", "On schedule")]),
      ]),
    );

    expect(slides.map((slide) => slide.key)).toEqual([
      "cover",
      "recurring-gmb_content",
      "recurring-gmb_posting",
      "section-client_note",
      "closing",
    ]);
    expect(slides.some((slide) => slide.key === "recurring-technical_seo")).toBe(false);
    expect(slides.some((slide) => slide.key === "recurring-performance")).toBe(false);
  });

  it("folds a Site Audits section into the Technical SEO slide", () => {
    const slides = buildReportSlides(
      report([section("site_audits", "Site Audits", [entry("Site Audit After", "0 issues")])]),
    );

    const tech = slides.find((slide) => slide.key === "recurring-technical_seo");
    expect(tech?.entries[0]).toMatchObject({ label: "Site Audit After", value: "0 issues" });
  });

  it("marks a completed one-time item on its slide", () => {
    const slides = buildReportSlides(
      report([
        section("one_time_setup", "One-time Setup", [
          {
            label: "100 Citations",
            value: "complete",
            url: null,
            one_time_item_key: "citations_100",
            one_time_completed: true,
          },
        ]),
      ]),
    );

    expect(oneTime(slides)[0]!.oneTimeCompleted).toBe(true);
  });

  it("leaves a one-time item unmarked when the data does not say it completed", () => {
    const slides = buildReportSlides(
      report([
        section("one_time_setup", "One-time Setup", [
          {
            label: "100 Citations",
            value: "in progress",
            url: null,
            one_time_item_key: "citations_100",
            one_time_completed: false,
          },
        ]),
      ]),
    );

    expect(oneTime(slides)[0]!.oneTimeCompleted).toBe(false);
  });

  it("the closing slide carries a continuity note for the next cycle", () => {
    const slides = buildReportSlides(report());

    const closing = slides.at(-1)!;
    expect(closing.kind).toBe("closing");
    expect(closing.subtitle).toMatch(/grow with Wolf Forge/);
  });
});
