import "server-only";

import { currentCorrelationId } from "../security/request-correlation";
import { recordSecurityEvent } from "../security/security-log";
import { IDENTITY_UNAVAILABLE_MESSAGE, IdentityLookupError } from "./identity-lookup";

export async function recordIdentityUnavailable(error: IdentityLookupError): Promise<void> {
  recordSecurityEvent({
    event: "system.database.failed",
    correlationId: await currentCorrelationId(),
    outcome: "failed",
    failureClass: "system_error",
    metadata: { action: "context.resolve", stage: error.stage, reason: "identity_unavailable" },
  });
}

export async function identityFailureResponse(error: unknown): Promise<Response> {
  if (!(error instanceof IdentityLookupError)) throw error;
  if (error.kind === "unavailable") await recordIdentityUnavailable(error);
  return Response.json(
    {
      ok: false,
      error: error.kind === "unavailable" ? IDENTITY_UNAVAILABLE_MESSAGE : error.kind === "unauthorized" ? "Access refused." : "Session expired.",
      ...(error.kind === "unavailable" ? { retryable: true } : {}),
    },
    {
      status: error.kind === "unavailable" ? 503 : error.kind === "unauthorized" ? 403 : 401,
      headers: { "cache-control": "private, no-store, max-age=0" },
    },
  );
}
