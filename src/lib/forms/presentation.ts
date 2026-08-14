import sanitizeHtml from "sanitize-html";

const allowedTags = [
  "h1", "h2", "h3", "h4", "p", "div", "span", "strong", "b", "em", "i",
  "u", "s", "br", "ul", "ol", "li", "blockquote", "hr", "a", "code",
];

export function sanitizeFormHtml(value: string | null | undefined) {
  if (!value) return "";
  return sanitizeHtml(value, {
    allowedTags,
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, rel: "noopener noreferrer" },
      }),
    },
  });
}

export const formTypeLabels = {
  order: "Order Forms",
  contact: "Contact Forms",
  intake: "Intake Forms",
  onboarding: "Onboarding Forms",
} as const;

export const formStatusLabels = {
  draft: "Draft",
  published: "Published",
  inactive: "Inactive",
  archived: "Archived",
} as const;

export const fieldTypeLabels: Record<string, string> = {
  text: "Text",
  textarea: "Long text",
  fullname: "Name",
  email: "Email",
  phone: "Phone",
  address: "Address",
  date: "Date",
  checkbox: "Checkbox",
  optin: "Opt-in",
  "data-option-group": "Option group",
  "data-dropdown": "Dropdown",
  optgroup: "Service options",
  dropdown: "Service dropdown",
  richtext: "Formatted text",
  break: "Section break",
  pagebreak: "Page break",
  html: "Custom HTML",
  file: "File",
  "data-spreadsheet": "Spreadsheet",
  signature: "Signature",
  hidden: "Hidden",
  secret: "Secret text",
  calendly: "Calendly",
  captcha: "Captcha",
  payment: "Payment",
  password: "Password",
};

export function titleCaseState(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
