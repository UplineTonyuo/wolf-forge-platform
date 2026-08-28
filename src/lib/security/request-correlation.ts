import "server-only";

import { headers } from "next/headers";
import {
  CORRELATION_HEADER,
  normalizeCorrelationId,
} from "../../domain/security/correlation-id";

/**
 * Reads the correlation identifier `src/proxy.ts` stamped on this request.
 *
 * ## Why the header, and not React `cache()` or AsyncLocalStorage
 *
 * `cache()` is per-render, and a server action is not the same render as the
 * page that submitted it — the two halves of one user-visible failure would get
 * different ids, which is the exact thing this is supposed to prevent.
 * `AsyncLocalStorage` would work inside the Node server but cannot be seeded
 * from the proxy, which runs in a different runtime with no shared memory.
 *
 * A forwarded request header is the one channel that spans proxy → route
 * handler → server component → server action, and Next surfaces it unchanged
 * through `next/headers`.
 *
 * ## Returning null is deliberate
 *
 * When the header is absent this returns `null` and the log record simply omits
 * `correlation_id`. It does NOT mint a replacement: a fresh id per call would
 * make two events from the same request look like two requests, which is worse
 * than an honest absence. Absence happens on paths the proxy matcher skips and
 * in unit tests; every real user-facing route is matched.
 */
export async function currentCorrelationId(): Promise<string | null> {
  try {
    const requestHeaders = await headers();
    return normalizeCorrelationId(requestHeaders.get(CORRELATION_HEADER));
  } catch {
    /*
     * `headers()` throws outside a request scope. A logger must never be the
     * reason a caller fails, so this degrades to "no correlation" rather than
     * propagating.
     */
    return null;
  }
}
