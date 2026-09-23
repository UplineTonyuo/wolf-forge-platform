// TEMPORARY: Sentry end-to-end verification surface. Remove after verification.
import { timingSafeEqual } from "node:crypto";

export function POST(request: Request) {
  const expected = process.env.SENTRY_VERIFY_SECRET;
  const provided = request.headers.get("x-wolf-forge-sentry-verify");
  const a = Buffer.from(provided ?? "");
  const b = Buffer.from(expected ?? "");
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response(null, { status: 404 });
  }

  const error = new Error("Controlled Sentry server verification error");
  error.name =
    process.env.VERCEL_ENV === "production"
      ? "WolfForgeSentryServerProductionVerificationError"
      : "WolfForgeSentryServerPreviewVerificationError";
  throw error;
}
