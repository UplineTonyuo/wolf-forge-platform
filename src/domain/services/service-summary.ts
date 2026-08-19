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
