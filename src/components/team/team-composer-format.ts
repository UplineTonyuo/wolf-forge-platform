import {
  BOLD_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  UNORDERED_LIST,
  type Transformer,
} from "@lexical/markdown";

/**
 * The composer's entire formatting vocabulary, and deliberately no more.
 *
 * This list IS the boundary. A format that has no transformer here cannot be
 * produced by the editor and cannot survive a paste, which is how headings,
 * quotes, code blocks and images stay out of Team chat without anything having
 * to strip them afterwards.
 *
 * Bold precedes italic so `**x**` is never read as an empty `*` pair, and the
 * chosen syntaxes — `**bold**`, `_italic_`, `[text](url)`, `- item`, `1. item`
 * — are exactly what TeamFormattedMessage already renders, what
 * stripTeamFormatting already strips, and what private.team_message_plain_text
 * already mirrors in SQL. Every V2.1 message stays readable, and no stored
 * message is rewritten.
 *
 * Kept in its own module so the editor's serialization contract can be
 * asserted without loading React or the editor UI.
 */
export const teamTransformers: Transformer[] = [
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_STAR,
  ITALIC_UNDERSCORE,
  LINK,
];
