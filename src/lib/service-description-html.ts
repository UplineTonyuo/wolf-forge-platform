import sanitizeHtml from "sanitize-html";

const allowedTags = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "br",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "a",
];

export function sanitizeServiceDescription(description: string | null | undefined) {
  if (!description) return "";

  return sanitizeHtml(description, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          rel: "noopener noreferrer",
        },
      }),
    },
  });
}

export function serviceDescriptionToPlainText(description: string | null | undefined) {
  if (!description) return "";
  const spacedDescription = description.replace(
    /<(?:br\s*\/?|\/(?:p|div|li|blockquote|h[1-6]))\s*>/giu,
    " ",
  );
  return sanitizeHtml(spacedDescription, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/giu, (entity) => {
      const decoded: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " ",
        "&#39;": "'",
        "&#x27;": "'",
      };
      return decoded[entity.toLowerCase()] ?? entity;
    })
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Splits captured marketing HTML into its visual lines.
 *
 * The catalogue's descriptions are block soup - a <div> per line, <br> inside
 * paragraphs, <li> in a few - and anything that wants to understand the shape of
 * a description (a prose lead versus an inclusion list) needs those lines kept
 * apart. serviceDescriptionToPlainText deliberately flattens them into one
 * string; this splits on the boundaries first and sanitizes each piece, so no
 * sentinel character is ever injected into user-visible text.
 */
export function serviceDescriptionBlocks(description: string | null | undefined): string[] {
  if (!description) return [];

  return description
    .split(/<(?:br\s*\/?|\/(?:p|div|li|blockquote|h[1-6]|tr))\s*>/giu)
    .map((block) => serviceDescriptionToPlainText(block))
    .filter((block) => block.length > 0);
}
