import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sanitizeHtml from "sanitize-html";
import { decodeHTML } from "entities";
import { FORM_PDF_MAX_BYTES, formPdfReceiptSchema, type FormPdfReceipt } from "./pdf-receipt";
import { readSignatureStrokes } from "./signature";

const excluded = new Set(["hidden", "secret", "password", "captcha", "payment"]);
const subsets = ["latin", "latin-ext", "vietnamese", "greek", "greek-ext", "cyrillic", "cyrillic-ext"];
const navy = rgb(0, 0.05, 0.32), muted = rgb(0.35, 0.38, 0.43);

export function formHtmlText(value: string | null) {
  if (!value) return "";
  const safe = sanitizeHtml(value, { allowedTags: ["p", "div", "br", "li", "h1", "h2", "h3", "h4", "a"], allowedAttributes: { a: ["href"] }, allowedSchemes: ["https", "http", "mailto", "tel"], allowProtocolRelative: false });
  return decodeHTML(sanitizeHtml(safe.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)").replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-4])>/gi, "\n"), { allowedTags: [], allowedAttributes: {} })).trim();
}

export async function renderSubmissionPdf(input: FormPdfReceipt) {
  const receipt = formPdfReceiptSchema.parse(input);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(receipt.form.title); doc.setSubject("Saved form submission and recorded signature");
  doc.setCreationDate(new Date(receipt.original.submitted_at));
  doc.setModificationDate(new Date(receipt.correction?.submitted_at ?? receipt.original.submitted_at));
  const fonts = await Promise.all(subsets.map(async (subset) => doc.embedFont(await readFile(join(process.cwd(), "src/assets/pdf-fonts", `inter-${subset}.woff`)), { subset: true })));
  const characterSets = fonts.map((font) => new Set(font.getCharacterSet()));
  const captionFont = fonts[0]!;
  let page!: PDFPage;
  let y = 0, escaped = false;
  type Glyph = { text: string; font: PDFFont; width: number };
  function newPage() {
    if (doc.getPageCount() >= 64) throw new Error("This submission has too many pages for a PDF download.");
    page = doc.addPage([595.28, 841.89]); y = 774;
    page.drawText("SUBMISSION RECORD", { x: 48, y: 807, size: 9, font: captionFont, color: navy });
    page.drawLine({ start: { x: 48, y: 796 }, end: { x: 547, y: 796 }, color: rgb(0.83, 0.85, 0.89), thickness: 0.7 });
  }
  function glyphs(text: string, size: number): Glyph[] {
    return Array.from(text).flatMap((char) => {
      const code = char.codePointAt(0)!;
      const index = characterSets.findIndex((set) => set.has(code));
      if (index >= 0 && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(char)) return [{ text: char, font: fonts[index]!, width: fonts[index]!.widthOfTextAtSize(char, size) }];
      escaped = true;
      return Array.from(`\\u{${code.toString(16).toUpperCase()}}`).map((text) => ({ text, font: fonts[0]!, width: fonts[0]!.widthOfTextAtSize(text, size) }));
    });
  }
  function wrappedLines(value: string, size: number) {
    const lines: Glyph[][] = []; let line: Glyph[] = [], width = 0;
    for (const paragraph of value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")) {
      for (const glyph of glyphs(paragraph, size)) {
        while (width + glyph.width > 499 && line.length) {
          let space = line.length - 1;
          while (space >= 0 && line[space]!.text !== " ") space--;
          const cut = space > 0 ? space + 1 : line.length;
          lines.push(line.slice(0, cut)); line = line.slice(cut); width = line.reduce((sum, g) => sum + g.width, 0);
        }
        line.push(glyph); width += glyph.width;
      }
      lines.push(line); line = []; width = 0;
    }
    return lines;
  }
  function text(value: string, size = 10.5, color = rgb(0.1, 0.12, 0.17)) {
    for (const row of wrappedLines(value, size)) {
      if (y < 62 + size) newPage();
      let x = 48;
      for (let start = 0; start < row.length;) {
        let end = start + 1; while (end < row.length && row[end]!.font === row[start]!.font) end++;
        const run = row.slice(start, end); page.drawText(run.map((g) => g.text).join(""), { x, y, size, font: row[start]!.font, color });
        x += run.reduce((sum, g) => sum + g.width, 0); start = end;
      }
      y -= size * 1.45;
    }
    y -= 7;
  }
  function heading(label: string) { if (y < 115) newPage(); y -= 10; text(label, 14, navy); }
  function answerValue(field: FormPdfReceipt["form"]["fields"][number], value: unknown): string {
    if (Array.isArray(value)) return value.map((item) => answerValue(field, item)).join("\n");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "string") {
      if (field.type === "file") return receipt.files.find((file) => file.id === value)?.name ?? "Private attachment (name unavailable)";
      return field.options.find((option) => option.id === value || option.value === value)?.label ?? value;
    }
    return value == null ? "" : JSON.stringify(value);
  }
  function answers(record: FormPdfReceipt["original"]) {
    for (const value of [...record.values].sort((a, b) => a.sort_order - b.sort_order)) {
      const field = receipt.form.fields.find((item) => item.key === value.stable_field_key);
      if (!field || excluded.has(field.type) || field.type === "signature") continue;
      if (y < 105) newPage(); text(value.label, 11, navy); text(answerValue(field, value.value) || "No answer recorded");
    }
  }
  newPage(); text(receipt.form.title, 20, navy);
  text(`Form version ${receipt.form.version_number} | Original submission\n${receipt.original.submitted_at}`, 9, muted);
  if (receipt.form.schema_hash) text(`Version fingerprint: ${receipt.form.schema_hash}`, 8, muted);
  if (receipt.form.information_html) { heading("Form instructions"); text(formHtmlText(receipt.form.information_html)); }
  heading("Original submitted form");
  for (const field of [...receipt.form.fields].sort((a, b) => a.sort_order - b.sort_order)) {
    if (excluded.has(field.type)) continue;
    const answer = receipt.original.values.find((value) => value.stable_field_key === field.key);
    if (field.type === "pagebreak" && y < 740) newPage();
    if (y < 105) newPage();
    text(field.label, ["break", "pagebreak"].includes(field.type) ? 14 : 11, navy);
    if (field.conditional) text("Conditional template content: this historical record does not establish whether this section was displayed on screen. It is included as form-version reference, not as additional signed terms.", 9, muted);
    if (field.html || field.help_html) text(formHtmlText(field.html ?? field.help_html));
    if (["break", "pagebreak", "html"].includes(field.type) || (field.type === "richtext" && field.display_only)) continue;
    if (field.type !== "signature") { text(answer ? answerValue(field, answer.value) || "No answer recorded" : "No answer recorded"); continue; }
    if (!answer) { text("No signature was recorded for this field."); continue; }
    const value = answer.value && typeof answer.value === "object" && !Array.isArray(answer.value) ? answer.value : {};
    const strokes = readSignatureStrokes(value.drawing);
    const signer = `Signer: ${typeof value.name === "string" ? value.name : "Not recorded"}`;
    const signing = `Signed: ${typeof value.signed_at === "string" ? value.signed_at : "Not recorded"}\nConsent: ${value.consent === true ? "Recorded" : "Not recorded"}`;
    const statement = typeof value.statement === "string" ? value.statement : null;
    const signingHeight = (wrappedLines(signer, 10.5).length + wrappedLines(signing, 10.5).length) * 10.5 * 1.45 + 14
      + (statement === null ? 0 : wrappedLines(statement, 9).length * 9 * 1.45 + 7) + (strokes ? 147 : 0);
    if (signingHeight <= 712 && y - signingHeight < 62) newPage();
    text(signer);
    text(signing);
    if (statement !== null) text(statement, 9, muted);
    if (strokes) {
      if (y < 190) newPage();
      page.drawRectangle({ x: 48, y: y - 130, width: 325, height: 130, borderColor: rgb(0.83, 0.85, 0.89), borderWidth: 0.7 });
      for (const stroke of strokes) for (let i = 1; i < stroke.length; i++) {
        const before = stroke[i - 1]!, current = stroke[i]!;
        page.drawLine({ start: { x: 48 + before[0] * 0.325, y: y - before[1] * 0.325 }, end: { x: 48 + current[0] * 0.325, y: y - current[1] * 0.325 }, color: navy, thickness: 1.2 });
      }
      y -= 147;
    }
  }
  if (receipt.correction) {
    heading(`Corrected responses - revision ${receipt.correction.revision_number}`);
    text(`${receipt.correction.submitted_at}\nThese corrections do not replace the original agreement, signature or signing timestamp.`, 9, muted);
    answers(receipt.correction);
  }
  if (escaped) { heading("Character notation"); text("Characters not supported by the embedded fonts are preserved as Unicode codes such as \\u{1F600}.", 9, muted); }
  for (const [index, sheet] of doc.getPages().entries()) {
    sheet.drawText(`${receipt.original.id} | ${index + 1}/${doc.getPageCount()}`, { x: 48, y: 34, size: 8, font: captionFont, color: muted });
  }
  const bytes = await doc.save();
  if (bytes.length > FORM_PDF_MAX_BYTES) throw new Error("The generated PDF is too large.");
  return bytes;
}
