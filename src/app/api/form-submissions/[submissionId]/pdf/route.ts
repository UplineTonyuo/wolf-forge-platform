import { z } from "zod";
import { getVerifiedSessionContext } from "../../../../../lib/supabase/next-server";
import { formPdfFilename, formPdfReceiptSchema } from "../../../../../lib/forms/pdf-receipt";
import { renderSubmissionPdf } from "../../../../../lib/forms/render-submission-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const context = await getVerifiedSessionContext();
    if (!context) return new Response("Sign in to download your form.", { status: 401, headers: privateHeaders });
    const parsed = z.uuid().safeParse((await params).submissionId);
    if (!parsed.success) return new Response("Form unavailable.", { status: 404, headers: privateHeaders });
    const result = await context.client.rpc("app_get_form_submission_pdf", { p_submission_id: parsed.data, p_include_project: true });
    if (result.error) return new Response("Form PDF unavailable.", { status: result.error.code === "WF429" ? 429 : 404, headers: { ...privateHeaders, ...(result.error.code === "WF429" ? { "Retry-After": "60" } : {}) } });
    const receipt = formPdfReceiptSchema.parse(result.data);
    const bytes = await renderSubmissionPdf(receipt);
    return new Response(Buffer.from(bytes), { headers: { ...privateHeaders, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${formPdfFilename(parsed.data)}"`, "Content-Length": String(bytes.length) } });
  } catch { return new Response("The PDF could not be prepared. Your saved form is unchanged.", { status: 503, headers: privateHeaders }); }
}
