import type {
  ReportDraftEntryInput,
  ReportDraftSectionInput,
} from "./schema";
import { maxReportEntries, maxReportSections, maxSectionEntries } from "./schema";

/**
 * The report builder's editing operations.
 *
 * Pure and total: every function takes the current sections and returns a new
 * array, so the editor component holds one piece of state and never mutates it,
 * and every rule here is testable without rendering anything.
 *
 * Order is array position. There is no sort_order to renumber, which is why
 * moving a section is a two-element swap rather than a resequencing pass — the
 * database stores ordinality, so what the operator sees is what is stored.
 */

/** A blank entry. Label is required before saving; value and URL never are. */
export function createEmptyEntry(): ReportDraftEntryInput {
  return { label: "", value: null, url: null };
}

/**
 * Turns a heading into a section key.
 *
 * Section keys stay open by design, but they are still lowercase snake_case at
 * the database CHECK, so a custom heading has to be reduced rather than
 * rejected. A heading with nothing usable left falls back to a stable custom
 * key rather than producing an empty one.
 */
export function toSectionKey(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 100)
    .replace(/_+$/u, "");

  return slug === "" ? "custom_section" : slug;
}

/**
 * A key that is unique within this report.
 *
 * Two custom sections called "Notes" are a reasonable thing for an operator to
 * want, and the section key is only an identity, so the second one gets a
 * suffix instead of an error.
 */
export function uniqueSectionKey(
  sections: readonly ReportDraftSectionInput[],
  candidate: string,
): string {
  const taken = new Set(sections.map((section) => section.section_key));
  if (!taken.has(candidate)) return candidate;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const next = `${candidate.slice(0, 95)}_${suffix}`;
    if (!taken.has(next)) return next;
  }

  return `${candidate.slice(0, 90)}_${Date.now()}`;
}

export function addSection(
  sections: readonly ReportDraftSectionInput[],
  title = "New section",
): ReportDraftSectionInput[] {
  if (sections.length >= maxReportSections) return [...sections];

  return [
    ...sections,
    {
      section_key: uniqueSectionKey(sections, toSectionKey(title)),
      title,
      entries: [],
    },
  ];
}

export function removeSection(
  sections: readonly ReportDraftSectionInput[],
  index: number,
): ReportDraftSectionInput[] {
  return sections.filter((_, position) => position !== index);
}

/**
 * Renames a section without re-keying it.
 *
 * The key is identity and the title is presentation. Re-deriving the key on
 * every keystroke would rewrite identity while the operator is still typing,
 * so a rename changes only what is displayed.
 */
export function renameSection(
  sections: readonly ReportDraftSectionInput[],
  index: number,
  title: string,
): ReportDraftSectionInput[] {
  return sections.map((section, position) =>
    position === index ? { ...section, title } : section,
  );
}

/** Swaps a section with its neighbour. Out-of-range moves are no-ops, not errors. */
export function moveSection(
  sections: readonly ReportDraftSectionInput[],
  index: number,
  direction: -1 | 1,
): ReportDraftSectionInput[] {
  const target = index + direction;
  if (index < 0 || index >= sections.length) return [...sections];
  if (target < 0 || target >= sections.length) return [...sections];

  const next = [...sections];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

export function addEntry(
  sections: readonly ReportDraftSectionInput[],
  sectionIndex: number,
): ReportDraftSectionInput[] {
  const totalEntries = countEntries(sections);

  return sections.map((section, position) => {
    if (position !== sectionIndex) return section;
    if (section.entries.length >= maxSectionEntries) return section;
    if (totalEntries >= maxReportEntries) return section;
    return { ...section, entries: [...section.entries, createEmptyEntry()] };
  });
}

export function removeEntry(
  sections: readonly ReportDraftSectionInput[],
  sectionIndex: number,
  entryIndex: number,
): ReportDraftSectionInput[] {
  return sections.map((section, position) =>
    position === sectionIndex
      ? {
          ...section,
          entries: section.entries.filter((_, index) => index !== entryIndex),
        }
      : section,
  );
}

export function updateEntry(
  sections: readonly ReportDraftSectionInput[],
  sectionIndex: number,
  entryIndex: number,
  patch: Partial<ReportDraftEntryInput>,
): ReportDraftSectionInput[] {
  return sections.map((section, position) =>
    position === sectionIndex
      ? {
          ...section,
          entries: section.entries.map((entry, index) =>
            index === entryIndex ? { ...entry, ...patch } : entry,
          ),
        }
      : section,
  );
}

export function moveEntry(
  sections: readonly ReportDraftSectionInput[],
  sectionIndex: number,
  entryIndex: number,
  direction: -1 | 1,
): ReportDraftSectionInput[] {
  return sections.map((section, position) => {
    if (position !== sectionIndex) return section;

    const target = entryIndex + direction;
    if (entryIndex < 0 || entryIndex >= section.entries.length) return section;
    if (target < 0 || target >= section.entries.length) return section;

    const entries = [...section.entries];
    const moved = entries[entryIndex]!;
    entries[entryIndex] = entries[target]!;
    entries[target] = moved;
    return { ...section, entries };
  });
}

export function countEntries(sections: readonly ReportDraftSectionInput[]): number {
  return sections.reduce((total, section) => total + section.entries.length, 0);
}

/**
 * The payload the RPCs accept.
 *
 * Trims, drops entries the operator started and abandoned (no label, no value,
 * no URL) and collapses blank optional fields to null. An abandoned row is not
 * an error worth blocking a save over — it is a row that was never filled in.
 */
export function normalizeDraftSections(
  sections: readonly ReportDraftSectionInput[],
): ReportDraftSectionInput[] {
  return sections.map((section) => ({
    section_key: section.section_key,
    title: section.title.trim(),
    entries: section.entries
      .map((entry) => ({
        label: entry.label.trim(),
        value: blankToNull(entry.value),
        url: blankToNull(entry.url),
        ...(entry.one_time_item_key
          ? { one_time_item_key: entry.one_time_item_key }
          : {}),
        ...(entry.one_time_item_key
          ? { one_time_completed: entry.one_time_completed ?? false }
          : {}),
      }))
      .filter((entry) => !(entry.label === "" && entry.value === null && entry.url === null)),
  }));
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export type DraftProblem = { sectionIndex: number; entryIndex: number | null; message: string };

/**
 * What is still wrong with this draft.
 *
 * Advisory only, and deliberately duplicated by the RPC: this exists so the
 * operator is told before a round trip, not so the server can trust the browser.
 */
export function findDraftProblems(
  sections: readonly ReportDraftSectionInput[],
): DraftProblem[] {
  const problems: DraftProblem[] = [];

  /*
   * Indices are the operator's indices, so this reads the sections as they are
   * rather than the normalized copy — an abandoned row is skipped, not
   * renumbered, so a reported problem always points at the row on screen.
   */
  sections.forEach((section, sectionIndex) => {
    if (section.title.trim() === "") {
      problems.push({ sectionIndex, entryIndex: null, message: "Give this section a title." });
    }

    section.entries.forEach((entry, entryIndex) => {
      const label = entry.label.trim();
      const value = blankToNull(entry.value);
      const url = blankToNull(entry.url);

      // Started and abandoned. Saving drops it, so it is not a problem.
      if (label === "" && value === null && url === null) return;

      if (label === "") {
        problems.push({ sectionIndex, entryIndex, message: "Every entry needs a label." });
      }

      if (url !== null && !isSafeUrl(url)) {
        problems.push({
          sectionIndex,
          entryIndex,
          message: "Links must start with http:// or https://.",
        });
      }

      if (entry.one_time_completed && value === null && url === null) {
        problems.push({
          sectionIndex,
          entryIndex,
          message: "Add a status or link before marking this one-time item complete.",
        });
      }
    });
  });

  return problems;
}

function isSafeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
