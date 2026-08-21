import { formatDate } from "../../lib/format";
import { isSafeReportUrl } from "./projections";
import { reportLaneLabels, type ClientReportDocument } from "./schema";

/**
 * Presentation view model for the client report slideshow.
 *
 * The client detail used to be one long scrolling document. This module shapes
 * the SAME `client_reports -> client_report_sections -> client_report_entries`
 * document into an ordered deck of slides so the portal can present the report
 * as a focused, one-slide-at-a-time story. Pure: no I/O, no auth, no schema
 * change — a report is still read through the same RPC and the full document
 * still renders behind the overlay.
 *
 * Ordering contract (D-* Reporting):
 * - cover slide first, closing slide last — always
 * - recurring monthly topics in the stable canonical order, only when present
 * - one-time / setup items only when this report's data actually contains them
 * - anything not recognised (custom sections, GEO Ranking, …) is kept as a
 *   generic section slide rather than dropped
 */

/** The stable order recurring monthly topics appear in the deck. */
export const recurringSlideOrder = [
  "technical_seo",
  "performance",
  "blog_content",
  "blog_posts",
  "youtube_stack",
  "podcast_stack",
  "press_releases",
  "gmb_content",
  "gmb_posting",
] as const;

export type RecurringSlideTopic = (typeof recurringSlideOrder)[number];

export const recurringSlideTitles: Record<RecurringSlideTopic, string> = {
  technical_seo: "Technical SEO",
  performance: "Performance",
  blog_content: "Blog Content",
  blog_posts: "Blog Posts",
  youtube_stack: "YouTube Stack",
  podcast_stack: "Podcast Stack",
  press_releases: "Press Releases",
  gmb_content: "GMB Content",
  gmb_posting: "GMB Posting",
};

/** The stable order one-time / setup items appear in, when present in the data. */
export const oneTimeSlideOrder = [
  "gmb_optimization",
  "directory_listings_100",
  "citations_100",
  "geo_prominence_boosters",
  "batch_geo_stack",
  "infinity_id_loop",
  "cloud_stack",
  "advanced_gstack",
] as const;

export type OneTimeSlideKey = (typeof oneTimeSlideOrder)[number];

export const oneTimeSlideTitles: Record<OneTimeSlideKey, string> = {
  gmb_optimization: "One-time GMB Optimization",
  directory_listings_100: "100 Directory Listings",
  citations_100: "100 Citations",
  geo_prominence_boosters: "Geo Prominence Boosters",
  batch_geo_stack: "Batch Geo Stack",
  infinity_id_loop: "Infinity ID Loop",
  cloud_stack: "Cloud Stack",
  advanced_gstack: "Advanced Gstack",
};

export type ReportSlideKind =
  | "cover"
  | "recurring"
  | "one_time"
  | "section"
  | "closing";

export type ReportSlideEntry = {
  label: string;
  /** Native text/status value, when the entry carries one. */
  value: string | null;
  /** Safe http(s) URL only; unsafe stored values are dropped at shape time. */
  url: string | null;
  /** Shared by a “…Before” / “…After” pair so the slide can render one transformation. */
  pairKey: string | null;
  pairRole: "before" | "after" | null;
  /** The paired base label, e.g. “Site Audit” for “Site Audit Before”. */
  pairBase: string | null;
};

export type ReportSlide = {
  key: string;
  kind: ReportSlideKind;
  title: string;
  subtitle: string | null;
  entries: ReportSlideEntry[];
  /** Cover metadata, derived from the report root. */
  cover?: {
    companyName: string;
    packageLabel: string;
    laneLabel: string;
    sentLabel: string;
  };
  /** True when a one-time item was marked complete in the data. */
  oneTimeCompleted?: boolean;
};

/* -----------------------------------------------------------------------------
 * Classification
 * -------------------------------------------------------------------------- */

type EntryLike = {
  label: string;
  value?: string | null;
  url?: string | null;
  one_time_item_key?: string | null;
  one_time_completed?: boolean;
};

type SectionLike = {
  section_key: string;
  title: string;
  entries: readonly EntryLike[];
};

/** Collapse casing, surrounding space and repeated whitespace for comparison. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const recurringKeyToTopic: Record<string, RecurringSlideTopic> = {
  technical_seo: "technical_seo",
  site_audits: "technical_seo",
  performance: "performance",
  blog_content: "blog_content",
  blog_posts: "blog_posts",
  youtube_stack: "youtube_stack",
  podcast_stack: "podcast_stack",
  press_releases: "press_releases",
  gmb_content: "gmb_content",
  gmb_posting: "gmb_posting",
};

const recurringTitleKeywords: Record<RecurringSlideTopic, readonly string[]> = {
  technical_seo: ["technical seo", "site audits"],
  performance: ["performance"],
  blog_content: ["blog content"],
  blog_posts: ["blog posts"],
  youtube_stack: ["youtube stack"],
  podcast_stack: ["podcast stack"],
  press_releases: ["press releases", "press release"],
  gmb_content: ["gmb content"],
  gmb_posting: ["gmb posting"],
};

const oneTimeIdentityMatchers: Record<
  OneTimeSlideKey,
  { keys: readonly string[]; labels: readonly string[] }
> = {
  gmb_optimization: {
    keys: ["gmb_optimization"],
    labels: ["one-time gmb optimization", "gmb optimization"],
  },
  directory_listings_100: {
    keys: ["directory_listings_100", "directory_listings"],
    labels: [
      "one-time setup of 100 directory listings",
      "100 directory listings",
      "directory listings",
    ],
  },
  citations_100: {
    keys: ["citations_100", "citations"],
    labels: ["one-time setup of 100 citations", "100 citations", "citations"],
  },
  geo_prominence_boosters: {
    keys: ["geo_prominence_boosters"],
    labels: ["geo prominence boosters", "geo prominence"],
  },
  batch_geo_stack: {
    keys: ["batch_geo_stack"],
    labels: ["batch geo stack"],
  },
  infinity_id_loop: {
    keys: ["infinity_id_loop"],
    labels: ["infinity id loop"],
  },
  cloud_stack: {
    keys: ["cloud_stack"],
    labels: ["cloud stack"],
  },
  advanced_gstack: {
    keys: ["advanced_gstack", "advance_gstack"],
    labels: ["advanced gstack", "advance gstack"],
  },
};

type SectionDestination =
  | { kind: "one_time_setup" }
  | { kind: "one_time"; key: OneTimeSlideKey | null; label: string }
  | { kind: "umbrella_blog" }
  | { kind: "umbrella_gmb" }
  | { kind: "recurring"; topic: RecurringSlideTopic }
  | { kind: "section" };

function classifySection(section: SectionLike): SectionDestination {
  const key = section.section_key;
  const title = normalize(section.title);

  if (key === "one_time_setup" || title.includes("one time setup")) {
    return { kind: "one_time_setup" };
  }

  for (const slideKey of oneTimeSlideOrder) {
    const matcher = oneTimeIdentityMatchers[slideKey];
    if (matcher.keys.includes(key)) {
      return { kind: "one_time", key: slideKey, label: oneTimeSlideTitles[slideKey] };
    }
    if (matcher.labels.some((label) => title.includes(label))) {
      return { kind: "one_time", key: slideKey, label: oneTimeSlideTitles[slideKey] };
    }
  }

  // The service-aware builder keeps Blog Content and Blog Posts in one section
  // titled “Blog Content / Blog Posts”; the two topics are presented separately.
  if (title.includes("blog content") && title.includes("blog posts")) {
    return { kind: "umbrella_blog" };
  }

  // The service-aware GMB Management section carries GMB Content and GMB Posting
  // as entries; distribute them to their own topics when present.
  if (key === "gmb_management" || title.includes("gmb management")) {
    return { kind: "umbrella_gmb" };
  }

  const byKey = recurringKeyToTopic[key];
  if (byKey) return { kind: "recurring", topic: byKey };

  for (const topic of recurringSlideOrder) {
    if (recurringTitleKeywords[topic].some((keyword) => title.includes(keyword))) {
      return { kind: "recurring", topic };
    }
  }

  return { kind: "section" };
}

function distributeEntries(
  section: SectionLike,
  topics: readonly { topic: RecurringSlideTopic; keywords: readonly string[] }[],
): { assigned: Partial<Record<RecurringSlideTopic, EntryLike[]>>; unmatched: EntryLike[] } {
  const assigned: Partial<Record<RecurringSlideTopic, EntryLike[]>> = {};
  const unmatched: EntryLike[] = [];

  for (const entry of section.entries) {
    const label = normalize(entry.label);
    const match = topics.find(({ keywords }) =>
      keywords.some((keyword) => label.includes(keyword)),
    );
    if (match) {
      (assigned[match.topic] ??= []).push(entry);
    } else {
      unmatched.push(entry);
    }
  }

  return { assigned, unmatched };
}

const blogUmbrellaTopics = [
  { topic: "blog_content" as const, keywords: ["blog content"] },
  { topic: "blog_posts" as const, keywords: ["blog posts"] },
];

const gmbUmbrellaTopics = [
  { topic: "gmb_content" as const, keywords: ["gmb content"] },
  { topic: "gmb_posting" as const, keywords: ["gmb posting"] },
];

function slugFromLabel(label: string): string {
  return normalize(label).replace(/[^a-z0-9]+/g, "_");
}

function oneTimeRank(key: string | null): number {
  if (!key) return oneTimeSlideOrder.length;
  const index = oneTimeSlideOrder.indexOf(key as OneTimeSlideKey);
  return index === -1 ? oneTimeSlideOrder.length : index;
}

function hasMeaningfulOneTimeContent(entry: EntryLike): boolean {
  const hasValue = typeof entry.value === "string" && entry.value.trim().length > 0;
  const hasSafeAsset = isSafeReportUrl(entry.url);
  return hasValue || hasSafeAsset || entry.one_time_completed === true;
}

type OneTimeSlide = {
  key: string;
  title: string;
  entries: EntryLike[];
  completed: boolean;
  order: number;
  sourceIndex: number;
};

/* -----------------------------------------------------------------------------
 * Before / after pairing
 * -------------------------------------------------------------------------- */

const PAIR_PATTERN = /^(.*?)\s+(before|after)$/iu;

function pairEntries(entries: readonly EntryLike[]): ReportSlideEntry[] {
  const byBase = new Map<string, { entry: EntryLike; role: "before" | "after" }[]>();

  for (const entry of entries) {
    const match = entry.label.match(PAIR_PATTERN);
    if (!match) continue;
    const base = match[1]!.trim();
    const list = byBase.get(base) ?? [];
    list.push({ entry, role: match[2]!.toLocaleLowerCase() === "before" ? "before" : "after" });
    byBase.set(base, list);
  }

  const paired = new Set<string>();
  for (const [base, list] of byBase) {
    if (list.some((item) => item.role === "before") && list.some((item) => item.role === "after")) {
      paired.add(base);
    }
  }

  return entries.map((entry) => {
    const match = entry.label.match(PAIR_PATTERN);
    const pairKey = match && paired.has(match[1]!.trim()) ? slugFromLabel(match[1]!.trim()) : null;

    return {
      label: entry.label,
      value: entry.value ?? null,
      url: isSafeReportUrl(entry.url) ? entry.url : null,
      pairKey,
      pairRole:
        pairKey && match
          ? (match[2]!.toLocaleLowerCase() === "before" ? "before" : "after")
          : null,
      pairBase: pairKey && match ? match[1]!.trim() : null,
    };
  });
}

/* -----------------------------------------------------------------------------
 * Public builder
 * -------------------------------------------------------------------------- */

export function buildReportSlides(report: ClientReportDocument): ReportSlide[] {
  const slides: ReportSlide[] = [
    {
      key: "cover",
      kind: "cover",
      title: report.title,
      subtitle: null,
      entries: [],
      cover: {
        companyName: report.company_name,
        packageLabel: report.package_label,
        laneLabel: reportLaneLabels[report.report_lane],
        sentLabel: formatDate(report.sent_at),
      },
    },
  ];

  const recurring: Partial<Record<RecurringSlideTopic, EntryLike[]>> = {};
  const generic: SectionLike[] = [];
  const oneTime: OneTimeSlide[] = [];
  let oneTimeSourceIndex = 0;

  for (const section of report.sections) {
    const destination = classifySection(section);

    switch (destination.kind) {
      case "one_time_setup": {
        for (const entry of section.entries) {
          if (!hasMeaningfulOneTimeContent(entry)) continue;
          const itemKey = entry.one_time_item_key ?? slugFromLabel(entry.label);
          oneTime.push({
            key: `one-time-${itemKey}`,
            title: entry.label,
            entries: [entry],
            completed: entry.one_time_completed === true,
            order: oneTimeRank(itemKey),
            sourceIndex: oneTimeSourceIndex++,
          });
        }
        break;
      }
      case "one_time": {
        const meaningfulEntries = section.entries.filter(hasMeaningfulOneTimeContent);
        if (meaningfulEntries.length === 0) break;
        oneTime.push({
          key: `one-time-${destination.key ?? slugFromLabel(destination.label)}`,
          title: destination.label,
          entries: meaningfulEntries,
          completed: meaningfulEntries.some((entry) => entry.one_time_completed === true),
          order: oneTimeRank(destination.key),
          sourceIndex: oneTimeSourceIndex++,
        });
        break;
      }
      case "umbrella_blog":
      case "umbrella_gmb": {
        const topics =
          destination.kind === "umbrella_blog" ? blogUmbrellaTopics : gmbUmbrellaTopics;
        const { assigned, unmatched } = distributeEntries(section, topics);
        for (const topic of topics) {
          const entries = assigned[topic.topic];
          if (entries?.length) (recurring[topic.topic] ??= []).push(...entries);
        }
        if (unmatched.length) generic.push({ ...section, entries: unmatched });
        break;
      }
      case "recurring": {
        (recurring[destination.topic] ??= []).push(...section.entries);
        break;
      }
      case "section": {
        generic.push(section);
        break;
      }
    }
  }

  // Recurring topics in the canonical order, only when this report has content.
  for (const topic of recurringSlideOrder) {
    const entries = recurring[topic];
    if (entries?.length) {
      slides.push({
        key: `recurring-${topic}`,
        kind: "recurring",
        title: recurringSlideTitles[topic],
        subtitle: null,
        entries: pairEntries(entries),
      });
    }
  }

  // One-time / setup items only when the data actually contains them, in the
  // stable order, with unknown items falling after the known catalogue. These
  // remain ahead of custom additions, matching the native report semantics.
  const rankedOneTime = [...oneTime].sort(
    (left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex,
  );
  for (const item of rankedOneTime) {
    slides.push({
      key: item.key,
      kind: "one_time",
      title: item.title,
      subtitle: null,
      entries: pairEntries(item.entries),
      oneTimeCompleted: item.completed,
    });
  }

  // Custom / unrecognised sections are kept after one-time setup, preserving
  // the service-aware report's recurring -> one-time -> custom narrative.
  for (const section of generic) {
    slides.push({
      key: `section-${section.section_key}`,
      kind: "section",
      title: section.title,
      subtitle: null,
      entries: pairEntries(section.entries),
    });
  }

  slides.push({
    key: "closing",
    kind: "closing",
    title: "Another month of progress",
    subtitle:
      "We’ll continue building on this momentum in the next cycle. Thank you for continuing to grow with Wolf Forge.",
    entries: [],
  });

  return slides;
}
