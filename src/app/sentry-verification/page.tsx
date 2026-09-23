// TEMPORARY: Sentry end-to-end verification surface. Remove after verification.
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SentryVerificationControls } from "./controls";

export default async function SentryVerificationPage() {
  const expected = process.env.SENTRY_VERIFY_SECRET;
  const provided = (await headers()).get("x-wolf-forge-sentry-verify");
  if (!expected || !provided) notFound();

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) notFound();

  return <SentryVerificationControls />;
}
