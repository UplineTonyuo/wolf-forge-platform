import { describe, expect, it } from "vitest";
import {
  applyQuickCompletedQuantity,
  blogPostsCompletedValue,
  clearOneTimeSetupEvidence,
  createServiceReportDraft,
  dropUnreportedOneTimeSection,
  hasReportedOneTimeCompletion,
  parseBlogCompletedCount,
  quickCompletedQuantityOptions,
  recurringReportSectionOrder,
  reportingProfileForService,
  reportingServiceIds,
  serviceReportingProfiles,
  withBlogDerivedYouTubeCount,
  wizardStepsForSections,
  youtubeStacksCompletedValue,
} from "../domain/reporting/service-profiles";
import { singleEntryRepeatsSectionTitle } from "../domain/reporting/present";
import {
  clientReportEntrySchema,
  clientReportSectionSchema,
  orderReportEntries,
  type ReportDraftSectionInput,
} from "../domain/reporting/schema";

/** Patches one known entry in a section array, leaving everything else untouched. */
function withEntry(
  sections: ReportDraftSectionInput[],
  sectionKey: string,
  label: string,
  patch: Partial<ReportDraftSectionInput["entries"][number]>,
): ReportDraftSectionInput[] {
  return sections.map((section) =>
    section.section_key === sectionKey
      ? {
          ...section,
          entries: section.entries.map((entry) =>
            entry.label === label ? { ...entry, ...patch } : entry,
          ),
        }
      : section,
  );
}

describe("service reporting profiles", () => {
  it("maps every supported profile by stable catalogue UUID", () => {
    expect(serviceReportingProfiles.map(({ serviceId, serviceName }) => [serviceId, serviceName]))
      .toEqual([
        [reportingServiceIds.gmbManagement, "GMB/GBP Management"],
        [reportingServiceIds.starterSeo, "Starter SEO"],
        [reportingServiceIds.foundationalSeo20, "Foundational SEO (20 Targeted Keywords)"],
        [reportingServiceIds.seoSuccessBlueprint50, "SEO Success Blueprint (50 Targeted Keywords)"],
        [reportingServiceIds.seoSuccessBlueprint895, "SEO Success Blueprint"],
        [reportingServiceIds.platinumSeo100, "Platinum SEO Success Blueprint (100 Targeted Keywords)"],
        [reportingServiceIds.bespokeSeoUnlimited, "Bespoke SEO Success Blueprint (Unlimited Targeted Keywords)"],
      ]);
    expect(reportingProfileForService("5f000000-0000-4000-8000-000000009999"))
      .toBeNull();
  });

  it.each([
    ["starterSeo", 1],
    ["foundationalSeo20", 2],
    ["platinumSeo100", 4],
    ["seoSuccessBlueprint50", 4],
    ["seoSuccessBlueprint895", 4],
    ["bespokeSeoUnlimited", 4],
  ] as const)("carries the expected recurring quantities for %s", (serviceKey, expected) => {
    const profile = reportingProfileForService(reportingServiceIds[serviceKey]);
    expect(profile?.expected).toEqual({
      press_releases: expected,
      blogs: expected,
      youtube_stacks: expected,
      podcast_stacks: expected,
    });
  });

  it("uses the explicit operational order with Technical before Performance", () => {
    expect(recurringReportSectionOrder).toEqual([
      "technical_seo",
      "performance",
      "blog_content",
      "youtube_stack",
      "podcast_stack",
      "press_releases",
      "gmb_management",
    ]);

    const profile = reportingProfileForService(reportingServiceIds.platinumSeo100)!;
    const steps = wizardStepsForSections(createServiceReportDraft(profile));
    expect(steps.indexOf("technical_seo")).toBeLessThan(steps.indexOf("performance"));
    expect(steps.at(-2)).toBe("custom_additions");
    expect(steps.at(-1)).toBe("review");
  });

  it("maps standalone GMB Management to its own lane and focused steps", () => {
    const profile = reportingProfileForService(reportingServiceIds.gmbManagement)!;
    const draft = createServiceReportDraft(profile);
    const steps = wizardStepsForSections(draft);

    expect(profile).toMatchObject({
      serviceId: "5f000000-0000-4000-8000-000000000318",
      serviceName: "GMB/GBP Management",
      reportLane: "gmb_management",
    });
    expect(draft.map((section) => section.section_key)).toEqual([
      "gmb_content",
      "gmb_posting",
    ]);
    expect(steps).toEqual([
      "gmb_content",
      "gmb_posting",
      "custom_additions",
      "review",
    ]);
    expect(steps).not.toContain("technical_seo");
    expect(steps).not.toContain("performance");
  });

  it("keeps all six SEO profiles on the unchanged SEO lane and section order", () => {
    const seoProfileIds = [
      reportingServiceIds.starterSeo,
      reportingServiceIds.foundationalSeo20,
      reportingServiceIds.platinumSeo100,
      reportingServiceIds.seoSuccessBlueprint50,
      reportingServiceIds.seoSuccessBlueprint895,
      reportingServiceIds.bespokeSeoUnlimited,
    ];

    for (const serviceId of seoProfileIds) {
      const profile = reportingProfileForService(serviceId)!;
      expect(profile.reportLane).toBe("seo_package");
      expect(createServiceReportDraft(profile).slice(0, 7).map((section) => section.section_key))
        .toEqual(recurringReportSectionOrder);
    }
  });

  it("includes only outstanding one-time items and keeps incomplete items eligible", () => {
    const profile = reportingProfileForService(reportingServiceIds.platinumSeo100)!;
    const firstCycle = createServiceReportDraft(profile);
    const nextCycle = createServiceReportDraft(profile, ["gmb_optimization"]);

    expect(firstCycle.find((section) => section.section_key === "one_time_setup")?.entries)
      .toHaveLength(3);
    expect(nextCycle.find((section) => section.section_key === "one_time_setup")?.entries
      .map((item) => item.one_time_item_key))
      .toEqual(["directory_listings_100", "citations_100"]);
    expect(createServiceReportDraft(profile, []).find(
      (section) => section.section_key === "one_time_setup",
    )?.entries.map((item) => item.one_time_item_key)).toContain("gmb_optimization");
  });

  it("creates expected press-release slots without claiming completed quantities", () => {
    const profile = reportingProfileForService(reportingServiceIds.foundationalSeo20)!;
    const draft = createServiceReportDraft(profile);

    expect(draft.find((section) => section.section_key === "press_releases")?.entries)
      .toHaveLength(2);
    expect(draft.find((section) => section.section_key === "blog_content")?.entries[1]?.value)
      .toBeNull();
    expect(draft.find((section) => section.section_key === "youtube_stack")?.entries[0]?.value)
      .toBeNull();
  });

  it("keeps the Bespoke large setup scope as manual candidates", () => {
    const profile = reportingProfileForService(reportingServiceIds.bespokeSeoUnlimited)!;
    expect(profile.oneTimeDeliverables.map((item) => item.key)).toEqual([
      "gmb_optimization",
      "directory_listings_100",
      "citations_100",
    ]);
    expect(profile.manualOneTimeCandidates).toContain("Infinity ID Loop");
    expect(profile.manualOneTimeCandidates).toContain("Standard Web Build");
  });
});

describe("structured report entries", () => {
  it("supports a text-only entry", () => {
    expect(
      clientReportEntrySchema.parse({
        label: "Technical SEO updated",
        sort_order: 0,
      }),
    ).toEqual({ label: "Technical SEO updated", sort_order: 0 });
  });

  it("supports an external URL entry", () => {
    expect(
      clientReportEntrySchema.safeParse({
        label: "August site audit",
        url: "https://reports.example.invalid/audit",
        sort_order: 0,
      }).success,
    ).toBe(true);
  });

  it("supports multiple explicitly ordered entries in one section", () => {
    const section = clientReportSectionSchema.parse({
      section_key: "geo_ranking",
      title: "GEO Ranking",
      sort_order: 0,
      entries: [
        { label: "junk removal service", value: "RANK 1.79", sort_order: 30 },
        { label: "junk removal", value: "RANK 2.12", sort_order: 10 },
        { label: "junk removal company", value: "RANK 1.22", sort_order: 20 },
      ],
    });

    expect(orderReportEntries(section.entries).map((entry) => entry.label)).toEqual([
      "junk removal",
      "junk removal company",
      "junk removal service",
    ]);
  });

  it("keeps URL optional for status information", () => {
    const parsed = clientReportEntrySchema.parse({
      label: "Press releases",
      value: "In progress",
      sort_order: 0,
    });

    expect(parsed.url).toBeUndefined();
    expect(parsed.value).toBe("In progress");
  });

  it("rejects an unsafe URL when one is provided", () => {
    expect(
      clientReportEntrySchema.safeParse({
        label: "Unsafe asset",
        url: "javascript:alert(1)",
        sort_order: 0,
      }).success,
    ).toBe(false);
  });
});

describe("singleEntryRepeatsSectionTitle", () => {
  it("hides a label that merely repeats a one-entry section's title", () => {
    expect(
      singleEntryRepeatsSectionTitle({
        title: "YouTube Stack",
        entries: [{ label: "Youtube Stack" }],
      }),
    ).toBe(true);
  });

  it("ignores casing and surrounding whitespace when comparing", () => {
    expect(
      singleEntryRepeatsSectionTitle({
        title: "  Blog  Content ",
        entries: [{ label: "blog content" }],
      }),
    ).toBe(true);
  });

  it("keeps the label when it adds information", () => {
    expect(
      singleEntryRepeatsSectionTitle({
        title: "Site Audits",
        entries: [{ label: "Site Audit Before" }],
      }),
    ).toBe(false);
  });

  it("keeps every label in a multi-entry section", () => {
    expect(
      singleEntryRepeatsSectionTitle({
        title: "Blog Content",
        entries: [{ label: "Blog 1" }, { label: "Blog 2" }],
      }),
    ).toBe(false);
  });

  it("never hides an empty label", () => {
    expect(
      singleEntryRepeatsSectionTitle({
        title: "Blog Content",
        entries: [{ label: "" }],
      }),
    ).toBe(false);
  });
});

describe("blog-derived shared completed quantity", () => {
  function platinumDraft(): ReportDraftSectionInput[] {
    const profile = reportingProfileForService(reportingServiceIds.platinumSeo100)!;
    return createServiceReportDraft(profile);
  }

  it("parses a whole-number blog count from the stored Blog Posts value", () => {
    expect(parseBlogCompletedCount("4 Blogs Posted")).toBe(4);
    expect(parseBlogCompletedCount("1 Blog Posted")).toBe(1);
    expect(parseBlogCompletedCount("3 Blogs completed")).toBe(3);
    expect(parseBlogCompletedCount(null)).toBeNull();
    expect(parseBlogCompletedCount("")).toBeNull();
    expect(parseBlogCompletedCount("four")).toBeNull();
  });

  it("renders Blog Posts as a singular or plural completed phrase", () => {
    expect(blogPostsCompletedValue(4)).toBe("4 Blogs Posted");
    expect(blogPostsCompletedValue(1)).toBe("1 Blog Posted");
    expect(blogPostsCompletedValue(0)).toBe("0 Blogs Posted");
    expect(blogPostsCompletedValue(null)).toBeNull();
  });

  it("renders YouTube Stack as a singular or plural completed phrase", () => {
    expect(youtubeStacksCompletedValue(4)).toBe("4 YouTube Stacks");
    expect(youtubeStacksCompletedValue(1)).toBe("1 YouTube Stack");
    expect(youtubeStacksCompletedValue(null)).toBeNull();
  });

  it("derives the YouTube count from the stored blog count", () => {
    const withBlog = withEntry(platinumDraft(), "blog_content", "Blog Posts", {
      value: "4 Blogs Posted",
    });

    const corrected = withBlogDerivedYouTubeCount(withBlog);

    expect(corrected.find((section) => section.section_key === "youtube_stack")?.entries[0]?.value)
      .toBe("4 YouTube Stacks");
  });

  it("updates the derived YouTube count when the stored blog count changes", () => {
    const changed = withEntry(platinumDraft(), "blog_content", "Blog Posts", {
      value: "3 Blogs Posted",
    });

    const corrected = withBlogDerivedYouTubeCount(changed);

    expect(corrected.find((section) => section.section_key === "youtube_stack")?.entries[0]?.value)
      .toBe("3 YouTube Stacks");
  });

  it("leaves YouTube empty when no blog count has been entered", () => {
    const corrected = withBlogDerivedYouTubeCount(platinumDraft());

    expect(corrected.find((section) => section.section_key === "youtube_stack")?.entries[0]?.value)
      .toBeNull();
  });

  it("never claims the expected quantity as a completed one", () => {
    // Platinum expects 4 of each, but the fresh draft stores no actual counts.
    const corrected = withBlogDerivedYouTubeCount(platinumDraft());

    expect(corrected.find((section) => section.section_key === "blog_content")?.entries[1]?.value)
      .toBeNull();
    expect(corrected.find((section) => section.section_key === "youtube_stack")?.entries[0]?.value)
      .toBeNull();
  });

  it("keeps the Podcast quantity independent of the blog count", () => {
    const withPodcast = withEntry(platinumDraft(), "podcast_stack", "Podcast Stacks", {
      value: "2 Podcast Stacks completed",
    });

    const corrected = withBlogDerivedYouTubeCount(withPodcast);

    expect(corrected.find((section) => section.section_key === "podcast_stack")?.entries[0]?.value)
      .toBe("2 Podcast Stacks completed");
  });

  it("rewrites only the derived value, never the asset URLs", () => {
    const withAssets = withEntry(platinumDraft(), "youtube_stack", "YouTube Stacks", {
      url: "https://reports.example.invalid/youtube",
    });
    const withBlog = withEntry(withAssets, "blog_content", "Blog Posts", {
      value: "4 Blogs Posted",
      url: "https://reports.example.invalid/blog-posts",
    });

    const corrected = withBlogDerivedYouTubeCount(withBlog);

    expect(corrected.find((section) => section.section_key === "youtube_stack")?.entries[0]).toEqual(
      expect.objectContaining({
        value: "4 YouTube Stacks",
        url: "https://reports.example.invalid/youtube",
      }),
    );
    expect(corrected.find((section) => section.section_key === "blog_content")?.entries[1])
      .toEqual(expect.objectContaining({
        value: "4 Blogs Posted",
        url: "https://reports.example.invalid/blog-posts",
      }));
  });

  it("is a no-op for a standalone GMB report that has no blog or YouTube sections", () => {
    const gmbProfile = reportingProfileForService(reportingServiceIds.gmbManagement)!;
    const draft = createServiceReportDraft(gmbProfile);

    expect(withBlogDerivedYouTubeCount(draft)).toEqual(draft);
  });
});

describe("quick-completed-quantity selector options", () => {
  it("offers sensible chips below the expected amount without duplicates", () => {
    expect(quickCompletedQuantityOptions(4)).toEqual([4, 3, 2, 1]);
    expect(quickCompletedQuantityOptions(2)).toEqual([2, 1, 0]);
    expect(quickCompletedQuantityOptions(1)).toEqual([1, 0]);
    expect(quickCompletedQuantityOptions(0)).toEqual([0]);
  });

  it("keeps the documented expected quantities for each package unchanged", () => {
    function profileFor(serviceId: string) {
      return reportingProfileForService(serviceId)!;
    }

    expect(profileFor(reportingServiceIds.platinumSeo100).expected.blogs).toBe(4);
    expect(profileFor(reportingServiceIds.platinumSeo100).expected.youtube_stacks).toBe(4);
    expect(profileFor(reportingServiceIds.platinumSeo100).expected.podcast_stacks).toBe(4);
    expect(profileFor(reportingServiceIds.seoSuccessBlueprint50).expected.blogs).toBe(4);
    expect(profileFor(reportingServiceIds.seoSuccessBlueprint895).expected.blogs).toBe(4);
    expect(profileFor(reportingServiceIds.bespokeSeoUnlimited).expected.blogs).toBe(4);
    expect(profileFor(reportingServiceIds.foundationalSeo20).expected.blogs).toBe(2);
    expect(profileFor(reportingServiceIds.starterSeo).expected.blogs).toBe(1);
  });
});

describe("applyQuickCompletedQuantity", () => {
  function platinumDraft(): ReportDraftSectionInput[] {
    const profile = reportingProfileForService(reportingServiceIds.platinumSeo100)!;
    return createServiceReportDraft(profile);
  }

  it("commits a blog count onto the shared Blog Posts entry", () => {
    const updated = applyQuickCompletedQuantity(platinumDraft(), "blog_content", 4);

    expect(
      updated.find((section) => section.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts"),
    ).toEqual(expect.objectContaining({ value: "4 Blogs Posted" }));
  });

  it("derives the YouTube count from the committed blog count", () => {
    const updated = withBlogDerivedYouTubeCount(
      applyQuickCompletedQuantity(platinumDraft(), "blog_content", 4),
    );

    expect(updated.find((section) => section.section_key === "youtube_stack")?.entries[0])
      .toEqual(expect.objectContaining({ value: "4 YouTube Stacks" }));
  });

  it("commits a podcast count independently of the blog count", () => {
    const updated = applyQuickCompletedQuantity(platinumDraft(), "podcast_stack", 2);

    expect(updated.find((section) => section.section_key === "podcast_stack")?.entries[0])
      .toEqual(expect.objectContaining({ value: "2 Podcast Stacks completed" }));
    expect(
      updated.find((section) => section.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts")?.value,
    ).toBeNull();
  });

  it("clears the entry when the committed count is null", () => {
    const withBlog = withEntry(platinumDraft(), "blog_content", "Blog Posts", {
      value: "4 Blogs Posted",
    });

    const updated = applyQuickCompletedQuantity(withBlog, "blog_content", null);

    expect(
      updated.find((section) => section.section_key === "blog_content")!
        .entries.find((entry) => entry.label === "Blog Posts")?.value,
    ).toBeNull();
  });

  it("is a no-op for steps that have no quick quantity", () => {
    const draft = platinumDraft();
    expect(applyQuickCompletedQuantity(draft, "technical_seo", 3)).toEqual(draft);
  });
});

describe("one-time setup skip semantics", () => {
  const platinumDraft = () =>
    createServiceReportDraft(
      reportingProfileForService(reportingServiceIds.platinumSeo100)!,
    );

  function fillFirstEntry(
    sections: ReportDraftSectionInput[],
    patch: Partial<ReportDraftSectionInput["entries"][number]>,
  ) {
    return sections.map((section) =>
      section.section_key === "one_time_setup"
        ? {
            ...section,
            entries: section.entries.map((entry, index) =>
              index === 0 ? { ...entry, ...patch } : entry,
            ),
          }
        : section,
    );
  }

  it("clears only the operator-authored evidence, keeping keys, labels and other sections", () => {
    const draft = fillFirstEntry(platinumDraft(), {
      value: "Completed",
      url: "https://example.invalid/asset",
      one_time_completed: true,
    });

    const cleared = clearOneTimeSetupEvidence(draft);

    const oneTime = cleared.find((section) => section.section_key === "one_time_setup")!;
    expect(oneTime.entries).toHaveLength(3);
    for (const entry of oneTime.entries) {
      expect(entry.value).toBeNull();
      expect(entry.url).toBeNull();
      expect(entry.one_time_completed).toBe(false);
      expect(entry.one_time_item_key).toBeTruthy();
      expect(entry.label).toBeTruthy();
    }
    // Recurring sections are untouched.
    expect(cleared.find((section) => section.section_key === "technical_seo")).toEqual(
      draft.find((section) => section.section_key === "technical_seo"),
    );
  });

  it("hasReportedOneTimeCompletion requires explicit completion with evidence", () => {
    const draft = platinumDraft();
    expect(hasReportedOneTimeCompletion(draft)).toBe(false);

    const statusOnly = fillFirstEntry(draft, { value: "In progress" });
    expect(hasReportedOneTimeCompletion(statusOnly)).toBe(false);

    const urlOnly = fillFirstEntry(draft, { url: "https://example.invalid/asset" });
    expect(hasReportedOneTimeCompletion(urlOnly)).toBe(false);

    const completedNoEvidence = fillFirstEntry(draft, { one_time_completed: true });
    expect(hasReportedOneTimeCompletion(completedNoEvidence)).toBe(false);

    const completedWithUrl = fillFirstEntry(draft, {
      url: "https://example.invalid/asset",
      one_time_completed: true,
    });
    expect(hasReportedOneTimeCompletion(completedWithUrl)).toBe(true);

    const completedWithValue = fillFirstEntry(draft, {
      value: "Completed",
      one_time_completed: true,
    });
    expect(hasReportedOneTimeCompletion(completedWithValue)).toBe(true);
  });

  it("dropUnreportedOneTimeSection removes only an empty one-time section", () => {
    const draft = platinumDraft();
    const dropped = dropUnreportedOneTimeSection(draft);

    expect(dropped.find((section) => section.section_key === "one_time_setup")).toBeUndefined();
    expect(dropped).toHaveLength(draft.length - 1);
    expect(dropped[0]).toEqual(draft[0]);
  });

  it("dropUnreportedOneTimeSection keeps a section with a completed evidenced entry", () => {
    const draft = fillFirstEntry(platinumDraft(), {
      value: "Completed",
      url: "https://example.invalid/asset",
      one_time_completed: true,
    });

    const kept = dropUnreportedOneTimeSection(draft);

    expect(kept).toEqual(draft);
    expect(kept.find((section) => section.section_key === "one_time_setup")).toBeDefined();
  });

  it("dropUnreportedOneTimeSection keeps other sections when one-time is empty", () => {
    const draft = platinumDraft();
    const dropped = dropUnreportedOneTimeSection(draft);
    expect(dropped.map((section) => section.section_key)).not.toContain("one_time_setup");
    expect(dropped.map((section) => section.section_key)).toContain("technical_seo");
    expect(dropped).toHaveLength(7);
  });
});
