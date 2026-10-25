import { revalidateTag } from "next/cache";
import {
  PODCAST_SYNC_EVENT_TYPE,
  isPodcastSyncTimestampFresh,
  isRecognizedPodcastSyncEventType,
  podcastSyncWebhookShapeSchema,
} from "../../../../../domain/operations/podcast-sync-webhook";
import { readOperationsSyncEnvironment } from "../../../../../lib/env/operations-sync-env";
import { PODCAST_SHEET_CACHE_TAG } from "../../../../../lib/integrations/google-sheets-source";
import { PODCAST_SYNC_VERSION_CACHE_TAG } from "../../../../../lib/integrations/podcast-sync-version";
import { operationsWebhookSignatureMatches } from "../../../../../lib/security/operations-webhook-hmac";
import { readBoundedText } from "../../../../../lib/security/bounded-text";
import { shouldTriggerPodcastSyncEffect } from "../../../../../lib/security/podcast-sync-guard";
import { currentCorrelationId } from "../../../../../lib/security/request-correlation";
import { recordSecurityEvent } from "../../../../../lib/security/security-log";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;
const SIGNATURE_HEADER = "x-wolf-forge-signature";

type RejectionReason =
  | "not_configured"
  | "malformed_payload"
  | "missing_signature"
  | "invalid_signature"
  | "invalid_event_type"
  | "stale_timestamp";

async function rejected(reason: RejectionReason, status: number): Promise<Response> {
  recordSecurityEvent({
    event: "integration.podcast_sync.rejected",
    correlationId: await currentCorrelationId(),
    actorClass: "anonymous",
    provider: "google",
    resourceType: "podcast_seo_sync_webhook",
    outcome: "denied",
    metadata: { reason },
  });
  return Response.json(
    { ok: false, error: "Request refused." },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Receives the Podcast SEO Apps Script change notification and turns it into
 * one Next.js cache invalidation — nothing more.
 *
 * This is the ONE Wolf Forge route reachable without a Supabase session:
 * Apps Script has no browser, no cookie jar, and no user to sign in as, so it
 * authenticates with an HMAC-SHA256 signature over the raw request body
 * instead of the usual HttpOnly cookie. That exception is scoped to this
 * single route — every other Operations surface still requires the normal
 * session, and this route never reads, forwards, or stores one.
 *
 * The signature is checked BEFORE the body is even parsed as JSON, so a
 * caller who does not know the shared secret learns nothing about shape,
 * timestamp, or event-type validation — every failure path available to
 * them returns the same 401. The payload itself never carries, and this
 * handler never reads for, client names, emails, credentials, login values,
 * sheet row contents, podcast URLs, notes, or any other workflow data — it
 * is exactly "something in the Podcast SEO workbook changed". Google Sheets
 * remains canonical: accepting this only makes the next request re-read it,
 * it never supplies data of its own.
 */
export async function POST(request: Request): Promise<Response> {
  let environment;
  try {
    environment = readOperationsSyncEnvironment();
  } catch {
    return rejected("not_configured", 503);
  }

  const signatureHeader = request.headers.get(SIGNATURE_HEADER);
  if (!signatureHeader) return rejected("missing_signature", 401);
  if (!/^[0-9a-f]{64}$/i.test(signatureHeader)) return rejected("invalid_signature", 401);

  const body = await readBoundedText(request, MAX_BODY_BYTES);
  if (!body.ok) return rejected("malformed_payload", body.status);
  const rawBody = body.value;
  if (
    !operationsWebhookSignatureMatches(
      rawBody,
      environment.OPERATIONS_SYNC_WEBHOOK_SECRET,
      signatureHeader,
    )
  ) {
    return rejected("invalid_signature", 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return rejected("malformed_payload", 400);
  }

  const shape = podcastSyncWebhookShapeSchema.safeParse(parsedJson);
  if (!shape.success) return rejected("malformed_payload", 400);

  if (!isRecognizedPodcastSyncEventType(shape.data.eventType)) {
    return rejected("invalid_event_type", 400);
  }

  if (!isPodcastSyncTimestampFresh(shape.data.timestamp, Date.now())) {
    return rejected("stale_timestamp", 400);
  }

  if (shouldTriggerPodcastSyncEffect(shape.data.nonce, Date.now())) {
    /*
     * `{ expire: 0 }`, not the recommended `profile: "max"` — this app's own
     * breaking-change docs (`node_modules/next/dist/docs/.../revalidateTag.md`)
     * call out `{ expire: 0 }` as the immediate-expiration form specifically
     * for webhooks: `profile: "max"` gives stale-while-revalidate semantics,
     * which would let the client's very next `/snapshot` refetch still see
     * the OLD cached value while a background revalidation happens
     * invisibly — defeating the "1-3 seconds after the edit" goal.
     */
    revalidateTag(PODCAST_SHEET_CACHE_TAG, { expire: 0 });
    revalidateTag(PODCAST_SYNC_VERSION_CACHE_TAG, { expire: 0 });
    recordSecurityEvent({
      event: "integration.podcast_sync.accepted",
      correlationId: await currentCorrelationId(),
      actorClass: "anonymous",
      provider: "google",
      resourceType: "podcast_seo_sync_webhook",
      outcome: "succeeded",
      metadata: { event_type: PODCAST_SYNC_EVENT_TYPE },
    });
  }

  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
