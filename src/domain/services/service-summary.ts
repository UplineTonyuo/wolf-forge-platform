import { serviceDescriptionBlocks } from "../../lib/service-description-html";

/**
 * Preview copy for the Store.
 *
 * The captured catalogue descriptions come in two shapes, and flattening both
 * into the first 190 characters — which is what the Store used to do — produces
 * a wall of check marks on a card:
 *
 *   prose-led      an emoji headline, a few real sentences, then the inclusions
 *   inclusion-only no prose at all, just "✅ 100 Citations", "✅ 1 Blog per month"
 *
 * So this reads the shape rather than the first N characters. Prose wins when
 * there is any; otherwise the inclusions are *summarised* into a sentence
 * instead of dumped. Either way the result is derived from the real description
 * — nothing is invented, and the full original still renders on the detail page
 * through `descriptionHtml`, which this never touches.
 */

/** Glyphs the catalogue uses to open an inclusion line. */
const bulletPattern = /^[\s•·‣▪▸▶⁃∙*\-–—+>✓✔✅❌☑☐]+/u;

/** Emoji and pictographs used as headline ornaments in the captured copy. */
const ornamentPattern = /[\p{Extended_Pictographic}️‍]/gu;

/**
 * Lines that are instructions to the buyer rather than things they receive.
 * "You must submit a 500 word article" is listed beside real inclusions in the
 * press-release captures, and reads absurdly in "Includes …".
 */
const requirementPattern = /^(you|your|please|note|if|we\s+recommend|kindly|\*)\b/iu;

/**
 * The same idea for prose, but far narrower: "Your Google Business Profile might
 * be costing you customers" is a perfectly good lead, so only an explicit
 * instruction to the buyer is rejected.
 */
const proseRequirementPattern = /^(you\s+(must|need|will|should|have\s+to)|please|note[:\s]|\*)/iu;

/** A pulled quote used as a rhetorical device. Never a good opening line. */
const quotedPattern = /^["'“‘„«]/u;

/**
 * Connectives that separate a sentence from a run of title-case labels. The
 * captures contain lines like "Core Google Entities Social Media Entities Web
 * 2.0 / Supporting Entities" — long enough to pass a length test, but a list of
 * headings rather than something a person wrote.
 */
const connectivePattern =
  /\s(the|your|you|we|our|a|an|is|are|was|be|to|of|and|or|for|with|that|this|it|its|on|in|by|from|as|so|but|will|can|have|has|their|they|them)\s/iu;

const maxSummaryLength = 165;
const maxInclusionsListed = 3;
/** Long enough that "One-time GMB Optimization for a stellar start" survives whole. */
const maxInclusionLength = 52;
const minProseLength = 55;
const minProseWords = 7;

function stripBullet(line: string): string {
  return line.replace(bulletPattern, "").trim();
}

function withoutOrnaments(line: string): string {
  return line.replace(ornamentPattern, "").replace(/\s+/gu, " ").trim();
}

function isBulleted(line: string): boolean {
  return bulletPattern.test(line) && stripBullet(line).length > 0;
}

/**
 * A label rather than a sentence: "WE'LL FIX THE FOUNDATION:", "🤖 WHAT'S
 * INCLUDED:", "🐺 MAPS OPTIMIZATION SYSTEM". Shouting or a trailing colon on a
 * short line is the tell.
 */
function isHeading(line: string): boolean {
  if (line.endsWith(":")) return true;
  if (line.length > 70) return false;

  const letters = line.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) return true;

  return letters === letters.toUpperCase();
}

/**
 * Reduces an inclusion to its head phrase: a trailing parenthetical, and
 * anything after a semicolon or dash, are elaboration that would otherwise be
 * cut mid-clause by the length cap.
 */
function trimInclusion(line: string): string {
  return withoutOrnaments(stripBullet(line))
    .replace(/\s*\([^)]*\)?\s*$/u, "")
    .split(/\s*[;–—]\s*|\s+-\s+/u)[0]!
    .replace(/[.;,]+$/u, "")
    .trim();
}

/**
 * Whether a line reads as something a person wrote rather than a label, a
 * pulled quote or an instruction to the buyer.
 */
function isProse(line: string): boolean {
  if (line.length < 40) return false;
  if (quotedPattern.test(line)) return false;
  if (proseRequirementPattern.test(line)) return false;
  if (line.split(/\s+/u).length < minProseWords) return false;
  return connectivePattern.test(line);
}

/** Words a clipped phrase must not end on: "…for a stellar start and…" reads broken. */
const danglingPattern = /\s+(and|or|the|a|an|to|of|for|with|in|on|at|by|from|plus|&)$/iu;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const clipped = value.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = (lastSpace > limit * 0.5 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
  return `${body.replace(danglingPattern, "").replace(/[,;:]$/u, "")}…`;
}

/**
 * Joins prose blocks into readable sentences. The captured copy relies on the
 * `<div>` boundary for its full stop, so concatenating raw gives "…keyword
 * research & analysis Analyze the effectiveness…".
 */
function joinProse(blocks: string[]): string {
  return blocks
    .reduce((sentence, block) => {
      if (sentence.length === 0) return block;
      const closed = /[.!?…]["'”’]?$/u.test(sentence);
      return `${sentence}${closed ? " " : ". "}${block}`;
    }, "")
    .trim();
}

/** Drops a closing quote left behind when its opener was in another block. */
function balanceQuotes(value: string): string {
  const withoutTrailing = value.replace(/\s*["'”»]\s*$/u, "");
  if (withoutTrailing === value) return value;
  // Only orphaned when nothing in the remaining text opened a quotation.
  return /["'“„«]/u.test(withoutTrailing) ? value : withoutTrailing;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Builds the preview line. Returns "" when the description carries nothing
 * usable, so callers can fall back to their own copy rather than render a
 * half-sentence.
 */
export function summarizeServiceDescription(description: string | null | undefined): string {
  const blocks = serviceDescriptionBlocks(description);
  if (blocks.length === 0) return "";

  const prose: string[] = [];
  const inclusions: string[] = [];

  for (const block of blocks) {
    if (isBulleted(block)) {
      const inclusion = trimInclusion(block);
      // Requirements and near-empty fragments are not things the client gets.
      if (inclusion.length > 2 && !requirementPattern.test(inclusion)) {
        inclusions.push(inclusion);
      }
      continue;
    }

    const line = withoutOrnaments(block);
    if (line.length === 0 || isHeading(line) || !isProse(line)) continue;
    prose.push(line);
  }

  // Prose path: the lead sentences, which is what a human wrote to explain it.
  const lead = balanceQuotes(joinProse(prose));
  if (lead.length >= minProseLength) return truncate(lead, maxSummaryLength);

  // Inclusion path: summarise the list rather than reprint it.
  const unique = [...new Set(inclusions)];
  if (unique.length > 0) {
    const listed = unique.slice(0, maxInclusionsListed).map((item) => truncate(item, maxInclusionLength));
    const remaining = unique.length - listed.length;
    const tail = remaining > 0 ? `, plus ${remaining} more inclusion${remaining === 1 ? "" : "s"}` : "";
    return truncate(`Includes ${joinWithAnd(listed)}${tail}.`, maxSummaryLength);
  }

  // Neither shape matched. Better an empty summary the card can omit than a
  // fragment of a heading presented as a description.
  return "";
}

/**
 * The same description, structured for an invoice line.
 *
 * `summarizeServiceDescription` above answers "what is this, in one line" for a
 * Store card. An invoice asks a different question — "what am I being billed
 * for" — and the honest answer is the itemised scope, not a sentence. Flattening
 * the capture into plain text, which is what the invoice used to do, produced a
 * paragraph of run-together check marks: "✅ 100 Citations ✅ 1 Blog per month
 * ✅ Weekly reporting…". Legible on nobody's invoice.
 *
 * So the shape is read once and split into the three things a description
 * actually contains, with every ornament removed:
 *
 *   summary       the prose lead, when a human wrote one
 *   deliverables  the bulleted lines — what the client receives
 *   requirements  lines addressed *to* the buyer ("You must supply artwork"),
 *                 which are real content but are not deliverables and must not
 *                 be listed as though the client is getting them
 *
 * Nothing is invented and nothing is summarised away: every bulleted line in the
 * original appears in `deliverables` in its original order. This only removes
 * emoji, bullet glyphs and duplicate lines.
 */
export type ServiceScope = {
  /** Prose lead, or "" when the description is inclusion-only. */
  summary: string;
  /** What the client receives, ornament-free, in source order. */
  deliverables: string[];
  /** Lines asking something of the buyer. Never mixed into deliverables. */
  requirements: string[];
  /**
   * Prose beyond the summary. Populated only for prose-only descriptions, so a
   * description with no bullet list still has something to expand into rather
   * than losing its body.
   */
  notes: string[];
  /** True when there is more to show than the collapsed line already shows. */
  hasDetail: boolean;
};

/** Trailing list punctuation left behind once the bullet glyph is gone. */
const trailingListPunctuation = /[\s.;,·•]+$/u;

/** A deliverable shorter than this is a fragment, not a line item. */
const minDeliverableLength = 3;

function cleanScopeLine(block: string): string {
  return withoutOrnaments(stripBullet(block)).replace(trailingListPunctuation, "").trim();
}

export function composeServiceScope(description: string | null | undefined): ServiceScope {
  const blocks = serviceDescriptionBlocks(description);

  const deliverables: string[] = [];
  const requirements: string[] = [];
  const prose: string[] = [];

  /*
   * Deduplicated by cleaned text. The captures repeat a line when the same
   * inclusion appeared under two headings, and an invoice listing the same
   * deliverable twice looks like a billing error rather than a formatting one.
   */
  const seen = new Set<string>();

  for (const block of blocks) {
    if (isBulleted(block)) {
      const line = cleanScopeLine(block);
      if (line.length < minDeliverableLength) continue;

      /*
       * A heading wearing a bullet is still a heading. The captures open their
       * inclusion lists with "✅ WHAT'S INCLUDED:", which passes isBulleted and
       * would otherwise be billed as the first deliverable — and inflate the
       * "Includes N deliverables" count by one on every such item.
       *
       * Checked after the glyph is stripped, because isHeading reads the words.
       * Deliberately local to this function: summarizeServiceDescription has
       * its own tested behaviour and is not changed here.
       */
      if (isHeading(line)) continue;

      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (requirementPattern.test(line)) requirements.push(line);
      else deliverables.push(line);
      continue;
    }

    const line = withoutOrnaments(block);
    // A heading is a label for the lines beneath it, not content of its own.
    if (line.length === 0 || isHeading(line)) continue;
    prose.push(line);
  }

  const summary = balanceQuotes(joinProse(prose.filter((line) => isProse(line))));
  const lead = summary.length >= minProseLength ? truncate(summary, maxSummaryLength) : "";

  /*
   * Notes exist only when there are no deliverables. With a bullet list present
   * the list *is* the detail, and repeating the marketing prose under it turns
   * an invoice back into a sales page.
   */
  const notes = deliverables.length === 0 && requirements.length === 0
    ? prose.filter((line) => line !== lead)
    : [];

  return {
    summary: lead,
    deliverables,
    requirements,
    notes,
    hasDetail: deliverables.length > 0 || requirements.length > 0 || notes.length > 0,
  };
}

/**
 * The single line a collapsed invoice item shows beneath its title.
 *
 * Prefers what a person wrote. Falls back to a count rather than to the first
 * deliverable, because one line lifted out of a list of twelve misrepresents
 * what is being billed. Returns "" when the description carries nothing, so the
 * caller renders the title alone instead of an empty element.
 */
export function scopeSummaryLine(scope: ServiceScope): string {
  if (scope.summary.length > 0) return scope.summary;

  const count = scope.deliverables.length;
  if (count > 0) return `Includes ${count} deliverable${count === 1 ? "" : "s"}`;

  return scope.notes[0] ?? "";
}
