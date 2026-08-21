import type { ReportDraftSectionInput, ReportLane } from "./schema";

/**
 * The one deterministic bridge from the live Services catalogue to Reporting.
 *
 * IDs are the real catalogue UUIDs produced from captured Wayfront source IDs
 * by private.import_wayfront_service_folder. Names are evidence and UI copy;
 * they are never the lookup key. A catalogue rename therefore cannot silently
 * remap a package or reset one-time completion state.
 */
export const reportingServiceIds = {
  gmbManagement: "5f000000-0000-4000-8000-000000000318",
  platinumSeo100: "5f000000-0000-4000-8000-000000000123",
  seoSuccessBlueprint50: "5f000000-0000-4000-8000-000000000124",
  starterSeo: "5f000000-0000-4000-8000-000000000546",
  seoSuccessBlueprint895: "5f000000-0000-4000-8000-000000000554",
  bespokeSeoUnlimited: "5f000000-0000-4000-8000-000000000555",
  foundationalSeo20: "5f000000-0000-4000-8000-000000000563",
} as const;

export type ReportingProfileId =
  | "gmb_management"
  | "platinum_seo_100"
  | "starter_seo"
  | "seo_success_blueprint_50"
  | "foundational_seo_20"
  | "seo_success_blueprint_895"
  | "bespoke_seo_unlimited";

export const recurringReportSectionOrder = [
  "technical_seo",
  "performance",
  "blog_content",
  "youtube_stack",
  "podcast_stack",
  "press_releases",
  "gmb_management",
] as const;

export type RecurringReportSectionKey = (typeof recurringReportSectionOrder)[number];

export const standaloneGmbSectionOrder = ["gmb_content", "gmb_posting"] as const;

export type StandaloneGmbSectionKey = (typeof standaloneGmbSectionOrder)[number];
export type ReportProfileSectionKey = RecurringReportSectionKey | StandaloneGmbSectionKey;

export type RecurringQuantityKey =
  | "press_releases"
  | "blogs"
  | "youtube_stacks"
  | "podcast_stacks";

export type RecurringQuantities = Record<RecurringQuantityKey, number>;

export type OneTimeEvidenceKind = "status_or_url";

export type OneTimeDeliverable = {
  key: string;
  label: string;
  evidence: OneTimeEvidenceKind;
};

export type ServiceReportingProfile = {
  id: ReportingProfileId;
  serviceId: string;
  /** Exact current catalogue name, retained for audit and mismatch warnings. */
  serviceName: string;
  /** Stable operator/client-facing package label copied onto each report. */
  packageLabel: string;
  /** The report's durable delivery lane; a standalone GMB service is not SEO. */
  reportLane: ReportLane;
  /** Explicit recurring section order for this profile. */
  recurringSections: readonly ReportProfileSectionKey[];
  expected: RecurringQuantities;
  oneTimeDeliverables: readonly OneTimeDeliverable[];
  /** Conservative candidates William may add manually; never auto-inserted. */
  manualOneTimeCandidates?: readonly string[];
};

const gmbOptimization: OneTimeDeliverable = {
  key: "gmb_optimization",
  label: "One-time GMB Optimization",
  evidence: "status_or_url",
};

const directoryListings: OneTimeDeliverable = {
  key: "directory_listings_100",
  label: "100 Directory Listings",
  evidence: "status_or_url",
};

const citations: OneTimeDeliverable = {
  key: "citations_100",
  label: "100 Citations",
  evidence: "status_or_url",
};

const commonSetup = [gmbOptimization, directoryListings, citations] as const;
const fourEach: RecurringQuantities = {
  press_releases: 4,
  blogs: 4,
  youtube_stacks: 4,
  podcast_stacks: 4,
};

export const serviceReportingProfiles: readonly ServiceReportingProfile[] = [
  {
    id: "gmb_management",
    serviceId: reportingServiceIds.gmbManagement,
    serviceName: "GMB/GBP Management",
    packageLabel: "GMB/GBP Management",
    reportLane: "gmb_management",
    recurringSections: standaloneGmbSectionOrder,
    expected: {
      press_releases: 0,
      blogs: 0,
      youtube_stacks: 0,
      podcast_stacks: 0,
    },
    oneTimeDeliverables: [],
  },
  {
    id: "starter_seo",
    serviceId: reportingServiceIds.starterSeo,
    serviceName: "Starter SEO",
    packageLabel: "Starter SEO",
    reportLane: "seo_package",
    recurringSections: recurringReportSectionOrder,
    expected: {
      press_releases: 1,
      blogs: 1,
      youtube_stacks: 1,
      podcast_stacks: 1,
    },
    oneTimeDeliverables: [gmbOptimization],
  },
  {
    id: "foundational_seo_20",
    serviceId: reportingServiceIds.foundationalSeo20,
    serviceName: "Foundational SEO (20 Targeted Keywords)",
    packageLabel: "Foundational SEO — 20 Keywords",
    reportLane: "seo_package",
    recurringSections: recurringReportSectionOrder,
    expected: {
      press_releases: 2,
      blogs: 2,
      youtube_stacks: 2,
      podcast_stacks: 2,
    },
    oneTimeDeliverables: commonSetup,
  },
  {
    id: "seo_success_blueprint_50",
    serviceId: reportingServiceIds.seoSuccessBlueprint50,
    serviceName: "SEO Success Blueprint (50 Targeted Keywords)",
    packageLabel: "SEO Success Blueprint — 50 Keywords",
    reportLane: "seo_package",
    recurringSections: recurringReportSectionOrder,
    expected: fourEach,
    oneTimeDeliverables: commonSetup,
  },
  {
    id: "seo_success_blueprint_895",
    serviceId: reportingServiceIds.seoSuccessBlueprint895,
    serviceName: "SEO Success Blueprint",
    packageLabel: "SEO Success Blueprint",
    reportLane: "seo_package",
    recurringSections: recurringReportSectionOrder,
    expected: fourEach,
    oneTimeDeliverables: [
      ...commonSetup,
      {
        key: "geo_prominence_boosters",
        label: "Geo Prominence Boosters",
        evidence: "status_or_url",
      },
      {
        key: "batch_geo_stack",
        label: "Batch Geo Stack",
        evidence: "status_or_url",
      },
      {
        key: "infinity_id_loop",
        label: "Infinity ID Loop",
        evidence: "status_or_url",
      },
      {
        key: "cloud_stack",
        label: "Cloud Stack",
        evidence: "status_or_url",
      },
      {
        key: "advanced_gstack",
        label: "Advanced Gstack",
        evidence: "status_or_url",
      },
    ],
  },
  {
    id: "platinum_seo_100",
    serviceId: reportingServiceIds.platinumSeo100,
    serviceName: "Platinum SEO Success Blueprint (100 Targeted Keywords)",
    packageLabel: "Platinum SEO",
    reportLane: "seo_package",
    recurringSections: recurringReportSectionOrder,
    expected: fourEach,
    oneTimeDeliverables: commonSetup,
  },
  {
    id: "bespoke_seo_unlimited",
    serviceId: reportingServiceIds.bespokeSeoUnlimited,
    serviceName: "Bespoke SEO Success Blueprint (Unlimited Targeted Keywords)",
    packageLabel: "Bespoke SEO Success Blueprint",
    reportLane: "seo_package",
    recurringSections: recurringReportSectionOrder,
    expected: fourEach,
    oneTimeDeliverables: commonSetup,
    manualOneTimeCandidates: [
      "Infinity ID Loop",
      "Cloud Stack",
      "Advanced Gstack",
      "30+ Page GEO Stack",
      "Advanced City + Neighborhood Pages 50+",
      "Standard Web Build",
      "1 million words / 600+ pages of content",
    ],
  },
] as const;

const profilesByServiceId = new Map(
  serviceReportingProfiles.map((profile) => [profile.serviceId, profile]),
);

export const supportedReportingServiceIds = serviceReportingProfiles.map(
  (profile) => profile.serviceId,
);

export function reportingProfileForService(
  serviceId: string | null | undefined,
): ServiceReportingProfile | null {
  if (!serviceId) return null;
  return profilesByServiceId.get(serviceId) ?? null;
}

export function reportingProfileSummary(profile: ServiceReportingProfile): string {
  if (profile.reportLane === "gmb_management") return "GMB Content · GMB Posting";
  return `${profile.expected.blogs} blogs · ${profile.expected.press_releases} press releases`;
}

export function outstandingOneTimeDeliverables(
  profile: ServiceReportingProfile,
  completedItemKeys: ReadonlySet<string> | readonly string[],
): OneTimeDeliverable[] {
  const completed = completedItemKeys instanceof Set
    ? completedItemKeys
    : new Set(completedItemKeys);
  return profile.oneTimeDeliverables.filter((item) => !completed.has(item.key));
}

export const reportWizardStepOrder = [
  ...recurringReportSectionOrder,
  ...standaloneGmbSectionOrder,
  "one_time_setup",
  "custom_additions",
  "review",
] as const;

export type ReportWizardStepKey = (typeof reportWizardStepOrder)[number];

export const reportWizardStepTitles: Record<ReportWizardStepKey, string> = {
  technical_seo: "Technical SEO",
  performance: "Performance",
  blog_content: "Blog Content / Blog Posts",
  youtube_stack: "YouTube Stack",
  podcast_stack: "Podcast Stack",
  press_releases: "Press Releases",
  gmb_management: "GMB Management",
  gmb_content: "GMB Content",
  gmb_posting: "GMB Posting",
  one_time_setup: "One-time Setup",
  custom_additions: "Custom additions",
  review: "Review report",
};

function entry(label: string): ReportDraftSectionInput["entries"][number] {
  return { label, value: null, url: null };
}

function createRecurringSection(
  profile: ServiceReportingProfile,
  sectionKey: ReportProfileSectionKey,
): ReportDraftSectionInput {
  switch (sectionKey) {
    case "technical_seo":
      return {
        section_key: sectionKey,
        title: "Technical SEO",
        entries: [entry("Site Audit Before"), entry("Site Audit After")],
      };
    case "performance":
      return {
        section_key: sectionKey,
        title: "Performance",
        entries: [
          entry("Desktop Before"),
          entry("Desktop After"),
          entry("Mobile Before"),
          entry("Mobile After"),
        ],
      };
    case "blog_content":
      return {
        section_key: sectionKey,
        title: "Blog Content / Blog Posts",
        entries: [entry("Blog Content"), entry("Blog Posts")],
      };
    case "youtube_stack":
      return {
        section_key: sectionKey,
        title: "YouTube Stack",
        entries: [entry("YouTube Stacks")],
      };
    case "podcast_stack":
      return {
        section_key: sectionKey,
        title: "Podcast Stack",
        entries: [entry("Podcast Stacks")],
      };
    case "press_releases":
      return {
        section_key: sectionKey,
        title: "Press Releases",
        entries: Array.from(
          { length: profile.expected.press_releases },
          (_, index) => entry(`Press Release ${index + 1}`),
        ),
      };
    case "gmb_management":
      return {
        section_key: sectionKey,
        title: "GMB Management",
        entries: [entry("GMB Content"), entry("GMB Posting")],
      };
    case "gmb_content":
      return {
        section_key: sectionKey,
        title: "GMB Content",
        entries: [entry("GMB Content")],
      };
    case "gmb_posting":
      return {
        section_key: sectionKey,
        title: "GMB Posting",
        entries: [entry("GMB Posting")],
      };
  }
}

/**
 * Creates the service-aware draft on the server.
 *
 * Expected quantities create prompts and link slots, never completion values.
 * Every actual count/value remains null until William enters it.
 */
export function createServiceReportDraft(
  profile: ServiceReportingProfile,
  completedItemKeys: ReadonlySet<string> | readonly string[] = [],
): ReportDraftSectionInput[] {
  const sections = profile.recurringSections.map((sectionKey) =>
    createRecurringSection(profile, sectionKey));

  const outstanding = outstandingOneTimeDeliverables(profile, completedItemKeys);
  if (outstanding.length > 0) {
    sections.push({
      section_key: "one_time_setup",
      title: "One-time Setup",
      entries: outstanding.map((item) => ({
        label: item.label,
        value: null,
        url: null,
        one_time_item_key: item.key,
        one_time_completed: false,
      })),
    });
  }

  return sections;
}

export function wizardStepsForSections(
  sections: readonly ReportDraftSectionInput[],
): ReportWizardStepKey[] {
  const sectionKeys = new Set(sections.map((section) => section.section_key));
  return reportWizardStepOrder.filter(
    (step) => step === "custom_additions" || step === "review" || sectionKeys.has(step),
  );
}

export function completedQuantityValue(
  quantity: number | null,
  singular: string,
  plural: string,
): string | null {
  if (quantity === null) return null;
  return `${quantity} ${quantity === 1 ? singular : plural} completed`;
}

export function parseCompletedQuantity(value: string | null | undefined): string {
  const match = value?.match(/^\s*(\d+)/u);
  return match?.[1] ?? "";
}

/* ---------------------------------------------------------------------------
 * The shared completed quantity for Blog Posts and YouTube Stack.
 *
 * William enters the actual number of completed blogs exactly once, on the
 * Blog step. That one count is the source of truth for both the Blog Posts
 * entry and the derived YouTube Stack count, so the report never asks for the
 * same number twice. The domain layer stays neutral: these helpers only parse
 * and render what is actually stored; they never seed a count from the
 * package's expected quantity. The wizard is the layer that offers the
 * expected amount as a default selection, which the operator confirms before
 * it is persisted. The count is parsed back from the Blog Posts entry's
 * value, which is where the number is stored. Podcast Stack stays an
 * independent, separately entered quantity.
 * ------------------------------------------------------------------------ */

/** The leading whole number in a stored completed-quantity value, or null when none is present. */
export function parseCompletedCount(value: string | null | undefined): number | null {
  const first = value?.match(/^\s*(\d+)/u)?.[1];
  return first ? Number.parseInt(first, 10) : null;
}

/** The whole-number blog count stored on the Blog Posts entry, or null when none is entered. */
export function parseBlogCompletedCount(value: string | null | undefined): number | null {
  return parseCompletedCount(value);
}

/** The Blog Posts entry value: "1 Blog Posted", "4 Blogs Posted", or null when unentered. */
export function blogPostsCompletedValue(count: number | null): string | null {
  if (count === null) return null;
  return count === 1 ? "1 Blog Posted" : `${count} Blogs Posted`;
}

/** The YouTube Stack entry value: "1 YouTube Stack", "4 YouTube Stacks", or null when unentered. */
export function youtubeStacksCompletedValue(count: number | null): string | null {
  if (count === null) return null;
  return count === 1 ? "1 YouTube Stack" : `${count} YouTube Stacks`;
}

/**
 * Derives the YouTube Stack count from the Blog Posts entry's stored value.
 *
 * A pure normalization so a saved draft can never carry a YouTube Stack count
 * that disagrees with the blog count William entered — no stale derived
 * quantity survives a save, even when the report was authored before this
 * rule. Asset URLs and every other section are left untouched.
 */
export function withBlogDerivedYouTubeCount(
  sections: readonly ReportDraftSectionInput[],
): ReportDraftSectionInput[] {
  const blogPosts = sections
    .find((section) => section.section_key === "blog_content")
    ?.entries.find((entry) => entry.label === "Blog Posts");
  const derived = youtubeStacksCompletedValue(parseBlogCompletedCount(blogPosts?.value));

  return sections.map((section) =>
    section.section_key === "youtube_stack"
      ? {
          ...section,
          entries: section.entries.map((entry) =>
            entry.label === "YouTube Stacks" ? { ...entry, value: derived } : entry,
          ),
        }
      : section,
  );
}

/**
 * The quick-select chip values offered for a recurring completed quantity.
 *
 * The set hangs below the profile's expected amount so William can accept the
 * expected delivery or step down a sensible increment. An expected 4 shows
 * [4 3 2 1]; an expected 2 shows [2 1 0]; an expected 1 shows [1 0]. Zero only
 * appears as a chip when the expected amount is small enough that
 * nothing-completed is a realistic neighbour; it is always reachable through
 * Custom. No duplicate is ever produced.
 */
export function quickCompletedQuantityOptions(expected: number): number[] {
  const options: number[] = [];
  for (let n = expected; n >= 0 && options.length < 4; n -= 1) {
    options.push(n);
  }
  return options;
}

/**
 * Writes a quick-select completed quantity into the wizard document.
 *
 * The Blog step commits the count onto the Blog Posts entry — the shared
 * source of truth that `withBlogDerivedYouTubeCount` copies onto YouTube
 * Stack. The Podcast step commits its own independent entry. A null count
 * clears the entry back to unentered. Every other section is left untouched.
 */
export function applyQuickCompletedQuantity(
  sections: readonly ReportDraftSectionInput[],
  step: ReportWizardStepKey,
  count: number | null,
): ReportDraftSectionInput[] {
  if (step === "blog_content") {
    return sections.map((section) =>
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
  }

  if (step === "podcast_stack") {
    return sections.map((section) =>
      section.section_key === "podcast_stack"
        ? {
            ...section,
            entries: section.entries.map((entry) =>
              entry.label === "Podcast Stacks"
                ? {
                    ...entry,
                    value: completedQuantityValue(count, "Podcast Stack", "Podcast Stacks"),
                  }
                : entry,
            ),
          }
        : section,
    );
  }

  return [...sections];
}

export function reportTitleSuggestion(
  profile: ServiceReportingProfile,
  date = new Date(),
): string {
  const month = date.toLocaleString("en-US", { month: "long" });
  return `${month} ${date.getFullYear()} ${profile.packageLabel} Report`;
}
