import { createHash } from "node:crypto";
import { z } from "zod";
import { getVerifiedSessionContext } from "../../../../../lib/supabase/next-server";
import { formPdfFilename, formPdfReceiptSchema } from "../../../../../lib/forms/pdf-receipt";
import { renderSubmissionPdf } from "../../../../../lib/forms/render-submission-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
const maxSignedBytes = 2 * 1024 * 1024;
const signedArchive = z.object({
  original_name: z.string().min(5).max(200),
  size_bytes: z.number().int().min(8).max(maxSignedBytes),
  sha256_hex: z.string().regex(/^[0-9a-f]{64}$/),
  contents_base64: z.string().max(4 * Math.ceil(maxSignedBytes / 3)),
});

function unavailable(code: string) {
  return new Response("Form PDF unavailable.", { status: code === "WF429" ? 429 : 404,
    headers: { ...privateHeaders, ...(code === "WF429" ? { "Retry-After": "60" } : {}) } });
}

export async function GET(request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const context = await getVerifiedSessionContext();
    if (!context) return new Response("Sign in to download your form.", { status: 401, headers: privateHeaders });
    const parsed = z.uuid().safeParse((await params).submissionId);
    if (!parsed.success) return new Response("Form unavailable.", { status: 404, headers: privateHeaders });
    if (new URL(request.url).searchParams.get("original") === "signed") {
      const result = await context.client.rpc("app_get_spp_signed_agreement", { p_submission_id: parsed.data });
      if (result.error) return unavailable(result.error.code);
      const archive = signedArchive.parse(result.data);
      const bytes = Buffer.from(archive.contents_base64, "base64");
      if (bytes.length !== archive.size_bytes || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
        || createHash("sha256").update(bytes).digest("hex") !== archive.sha256_hex) {
        throw new Error("Invalid archived agreement");
      }
      const name = encodeURIComponent(archive.original_name).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
      return new Response(bytes, { headers: { ...privateHeaders, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="signed-agreement.pdf"; filename*=UTF-8''${name}`,
        "Content-Length": String(bytes.length) } });
    }
    const result = await context.client.rpc("app_get_form_submission_pdf", { p_submission_id: parsed.data, p_include_project: true });
    if (result.error) return unavailable(result.error.code);
    const receipt = formPdfReceiptSchema.parse(result.data);
    const bytes = await renderSubmissionPdf(receipt);
    return new Response(Buffer.from(bytes), { headers: { ...privateHeaders, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${formPdfFilename(parsed.data)}"`, "Content-Length": String(bytes.length) } });
  } catch { return new Response("The PDF could not be prepared. Your saved form is unchanged.", { status: 503, headers: privateHeaders }); }
}
