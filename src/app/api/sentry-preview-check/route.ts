// TEMPORARY: Sentry Preview verification. Remove before merge.
export function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new Response(null, { status: 404 });
  }

  throw new Error("wolf-forge-sentry-preview-check: controlled Preview error");
}
