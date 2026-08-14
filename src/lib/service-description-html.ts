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
