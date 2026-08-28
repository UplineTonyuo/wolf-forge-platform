export function normalizeTeamLinkTarget(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!(["http:", "https:", "mailto:"] as string[]).includes(url.protocol)) return null;
    if (url.protocol === "mailto:" && !url.pathname.trim()) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The characters the composer's serializer escapes when they appear as ordinary
 * prose rather than as formatting, so `2*3 costs _less` is stored as
 * `2\*3 costs \_less` and reaches the reader as it was typed.
 *
 * A legacy V2.1 body carries no escapes, so every reader below is the identity
 * on every historical message.
 */
const escapableMarkers = "\\*_`~";
const escapePattern = /\\([\\*_`~])/g;

export type TeamInlineToken =
  | { type: "text"; value: string }
  | { type: "strong"; children: TeamInlineToken[] }
  | { type: "emphasis"; children: TeamInlineToken[] }
  | { type: "link"; href: string | null; children: TeamInlineToken[] };

function appendInlineText(tokens: TeamInlineToken[], value: string) {
  if (!value) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.type === "text") {
    previous.value += value;
    return;
  }
  tokens.push({ type: "text", value });
}

function findInlineDelimiter(
  value: string,
  start: number,
  end: number,
  delimiter: "**" | "_" | "*",
): number {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (value[cursor] === "\\" && escapableMarkers.includes(value[cursor + 1] ?? "")) {
      cursor += 1;
      continue;
    }
    if (!value.startsWith(delimiter, cursor)) continue;
    if (
      delimiter === "*" &&
      (value[cursor - 1] === "*" || value[cursor + 1] === "*")
    ) {
      continue;
    }
    return cursor;
  }
  return -1;
}

type TeamLinkParts = {
  labelStart: number;
  labelEnd: number;
  href: string;
  end: number;
};

/** Finds one complete inline link, including balanced parentheses in its URL. */
function readInlineLink(value: string, start: number, end: number): TeamLinkParts | null {
  let labelEnd = -1;
  for (let cursor = start + 1; cursor < end; cursor += 1) {
    if (value[cursor] === "\n") return null;
    if (value[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (value[cursor] === "]" && value[cursor + 1] === "(") {
      labelEnd = cursor;
      break;
    }
  }
  if (labelEnd < 0) return null;

  let depth = 1;
  for (let cursor = labelEnd + 2; cursor < end; cursor += 1) {
    if (value[cursor] === "\n") return null;
    if (value[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (value[cursor] === "(") depth += 1;
    if (value[cursor] !== ")") continue;
    depth -= 1;
    if (depth === 0) {
      return {
        labelStart: start + 1,
        labelEnd,
        href: value.slice(labelEnd + 2, cursor),
        end: cursor + 1,
      };
    }
  }
  return null;
}

function parseInlineRange(
  value: string,
  start: number,
  end: number,
  allowLinks: boolean,
): TeamInlineToken[] {
  const tokens: TeamInlineToken[] = [];

  for (let cursor = start; cursor < end;) {
    const marker = value[cursor]!;

    if (marker === "\\" && escapableMarkers.includes(value[cursor + 1] ?? "")) {
      appendInlineText(tokens, value[cursor + 1]!);
      cursor += 2;
      continue;
    }

    if (allowLinks && marker === "[") {
      const link = readInlineLink(value, cursor, end);
      if (link) {
        tokens.push({
          type: "link",
          href: normalizeTeamLinkTarget(link.href),
          /* Nested anchors are invalid HTML and never emitted by Lexical. */
          children: parseInlineRange(value, link.labelStart, link.labelEnd, false),
        });
        cursor = link.end;
        continue;
      }
    }

    if (value.startsWith("**", cursor)) {
      const close = findInlineDelimiter(value, cursor + 2, end, "**");
      if (close >= 0) {
        tokens.push({
          type: "strong",
          children: parseInlineRange(value, cursor + 2, close, allowLinks),
        });
        cursor = close + 2;
        continue;
      }
    }

    if (marker === "_") {
      const close = findInlineDelimiter(value, cursor + 1, end, "_");
      if (close >= 0) {
        tokens.push({
          type: "emphasis",
          children: parseInlineRange(value, cursor + 1, close, allowLinks),
        });
        cursor = close + 1;
        continue;
      }
    }

    if (marker === "*" && value[cursor + 1] !== "*") {
      const close = findInlineDelimiter(value, cursor + 1, end, "*");
      if (close >= 0) {
        tokens.push({
          type: "emphasis",
          children: parseInlineRange(value, cursor + 1, close, allowLinks),
        });
        cursor = close + 1;
        continue;
      }
    }

    appendInlineText(tokens, marker);
    cursor += 1;
  }

  return tokens;
}

/**
 * Parses the deliberately small Team inline grammar into data, never HTML.
 * Formatting may nest inside links or other formatting; unsupported or
 * unmatched syntax remains literal text.
 */
export function parseTeamInlineFormatting(value: string): TeamInlineToken[] {
  return parseInlineRange(value, 0, value.length, true);
}

/** Parks each escaped marker in a private-use code point of its own. */
function parkEscapes(value: string): string {
  return value.replace(escapePattern, (_match, marker: string) =>
    String.fromCharCode(0xe000 + escapableMarkers.indexOf(marker)),
  );
}

function restoreEscapes(value: string): string {
  return value.replace(
    /[\uE000-\uE004]/g,
    (parked) => escapableMarkers[parked.charCodeAt(0) - 0xe000]!,
  );
}

/** Drops the escape and keeps the character it was protecting. */
export function unescapeTeamFormatting(value: string): string {
  return value.replace(escapePattern, "$1");
}

/**
 * Search snippet highlighting. `app_search_team_conversation_messages` asks
 * Postgres's `ts_headline` to wrap each match in a private-use sentinel pair
 * (U+E005 / U+E006) instead of `<b>`/`</b>`, so the browser never receives
 * HTML to inject — it splits plain text on two code points nobody can type
 * and renders `<mark>` nodes directly.
 */
const snippetHighlightStart = "";
const snippetHighlightStop = "";

export type TeamSnippetSegment = { text: string; matched: boolean };

export function parseTeamHighlightedSnippet(snippet: string): TeamSnippetSegment[] {
  const segments: TeamSnippetSegment[] = [];
  let index = 0;

  while (index < snippet.length) {
    const start = snippet.indexOf(snippetHighlightStart, index);
    if (start < 0) {
      segments.push({ text: snippet.slice(index), matched: false });
      break;
    }
    if (start > index) segments.push({ text: snippet.slice(index, start), matched: false });

    const stop = snippet.indexOf(snippetHighlightStop, start + 1);
    const matchEnd = stop < 0 ? snippet.length : stop;
    segments.push({ text: snippet.slice(start + 1, matchEnd), matched: true });
    index = stop < 0 ? snippet.length : stop + 1;
  }

  return segments.filter((segment) => segment.text.length > 0);
}

/** Plain-text form for tasks, previews, peeks and search-oriented projections. */
export function stripTeamFormatting(value: string): string {
  /*
   * Escapes are parked before the real markers are removed and restored after.
   * Stripping first would leave a stray backslash in every preview; unescaping
   * first would let a deliberate `\*` be read as emphasis. Mirrored in SQL by
   * private.team_message_plain_text.
   */
  return restoreEscapes(
    parkEscapes(value)
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "")
      .replace(/[*_`#]/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
