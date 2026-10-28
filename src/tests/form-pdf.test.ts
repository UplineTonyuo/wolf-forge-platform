import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { formPdfReceiptSchema, formPdfFilename } from "../lib/forms/pdf-receipt";
import { formHtmlText, renderSubmissionPdf } from "../lib/forms/render-submission-pdf";
import { receiptFixture } from "./fixtures/form-pdf-fixture";
vi.mock("server-only", () => ({}));

describe("saved form PDF", () => {
  it("creates a readable real PDF containing ink, a pinned version and server signing metadata", async () => {
    const bytes = await renderSubmissionPdf(receiptFixture());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
    expect(doc.getTitle()).toBe("Synthetic SEO onboarding");
    expect(doc.getCreationDate()?.toISOString()).toBe("2026-10-27T06:30:00.000Z");
    expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
  });
  it("removes executable markup and preserves entities, line breaks and source links", () => {
    const text = formHtmlText('<p>Terms &amp; conditions</p><script>evil()</script><a href="https://example.invalid/sop">SOP</a><a href="javascript:evil()">Bad link</a>');
    expect(text).toContain("Terms & conditions\n");expect(text).toContain("https://example.invalid/sop");expect(text).not.toContain("evil");expect(text).not.toContain("<");
  });
  it("uses an identifier-only filename and refuses header/path injection", () => {
    expect(formPdfFilename(receiptFixture().original.id)).toMatch(/^form-submission-[a-f0-9-]+\.pdf$/);
    expect(() => formPdfFilename('../x\r\nSet-Cookie:bad')).toThrow();
  });
  it("renders unnamed drawn signatures without inventing a signer name", async () => {
    const value = receiptFixture();
    const signature = value.original.values.find((answer) => answer.field_type === "signature")!;
    const signedValue = signature.value as Record<string, unknown>;
    delete signedValue.name;
    expect(formPdfReceiptSchema.safeParse(value).success).toBe(true);
    const text: string[] = [];
    const original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, line, options) {
      text.push(line); return original.call(this, line, options);
    });
    try {
      await renderSubmissionPdf(value);
      expect(text.join("\n")).toContain("Drawn electronic signature");
      expect(text.join("\n")).not.toContain("Signer: Synthetic Signer");
    } finally { spy.mockRestore(); }
  });
  it("refuses an oversized receipt before font/layout work", async () => {
    const value = receiptFixture(); value.form.information_html = "x".repeat(350_001);
    expect(formPdfReceiptSchema.safeParse(value).success).toBe(false);
    await expect(renderSubmissionPdf(value)).rejects.toThrow(/too large/);
  });
  it("preserves administrator attribution for a support-recorded signature", async () => {
    const value = receiptFixture();
    const signature = value.original.values.find((answer) => answer.field_type === "signature")!;
    if (!signature.value || typeof signature.value !== "object" || Array.isArray(signature.value)) throw new Error("Missing signature fixture");
    signature.value = { ...signature.value,
      support_administrator_id: "90000000-0000-4000-8000-000000000001",
      support_session_id: "90000000-0000-4000-8000-000000000002" };
    const lines: string[] = [];
    const draw = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, line, options) {
      lines.push(line); return draw.call(this, line, options);
    });
    try {
      await renderSubmissionPdf(value);
      expect(lines.join(" ")).toContain("Recorded by authorized support on behalf of this client.");
    } finally { spy.mockRestore(); }
  });
  it("accepts the established maximum labels and option values", () => {
    const value = receiptFixture();value.form.fields[0]!.label = "x".repeat(500);
    value.original.values[0]!.label = "y".repeat(500);
    value.form.fields[0]!.options = [{ id: "choice", value: "z".repeat(500), label: "a".repeat(500) }];
    expect(formPdfReceiptSchema.safeParse(value).success).toBe(true);
  });
  it("paginates long agreements without dropping the end", async () => {
    const value = receiptFixture(); value.form.fields[1]!.help_html = Array.from({ length: 160 }, (_, n) => `<p>Clause ${n}: Synthetic agreement text must be preserved completely.</p>`).join("");
    const doc = await PDFDocument.load(await renderSubmissionPdf(value));
    expect(doc.getPageCount()).toBeGreaterThan(4);
  });
  it.each([24, 28, 32, 36, 40, 44])("keeps the signer and drawn ink together after %i agreement lines", async (lines) => {
    const value = receiptFixture();
    value.form.fields[1]!.help_html = Array.from({ length: lines }, (_, index) => `<p>Clause ${index}: The original service agreement remains recorded.</p>`).join("");
    const signerPages: string[] = [], inkPages: string[] = [];
    const originalText = PDFPage.prototype.drawText, originalRectangle = PDFPage.prototype.drawRectangle;
    const textSpy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      if (text.startsWith("Signer:")) signerPages.push(this.ref.toString());
      return originalText.call(this, text, options);
    });
    const inkSpy = vi.spyOn(PDFPage.prototype, "drawRectangle").mockImplementation(function (this: PDFPage, options) {
      if (options?.width === 325 && options.height === 130) inkPages.push(this.ref.toString());
      return originalRectangle.call(this, options);
    });
    try {
      await renderSubmissionPdf(value);
      expect(signerPages).toHaveLength(1);
      expect(inkPages).toEqual(signerPages);
    } finally { textSpy.mockRestore(); inkSpy.mockRestore(); }
  });
});
