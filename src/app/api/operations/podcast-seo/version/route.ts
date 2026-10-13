import { getPodcastSyncVersion } from "../../../../../lib/integrations/podcast-sync-version";
import { getInternalActorContext } from "../../../../../lib/supabase/next-server";
import { identityFailureResponse } from "../../../../../lib/supabase/identity-failure-response";
import { isWolfForgeTenant } from "../../../../../domain/tenancy/wolf-forge-tenant";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store, max-age=0" };

/**
 * The cheap "did anything change" signal an open Podcast Operations tab
 * polls every ~1s. Answers from the same Next.js Data Cache entry the sync
 * webhook invalidates — it never itself calls Google Sheets. Only the
 * debounced refetch against `/snapshot`, triggered when this value changes,
 * does that.
 *
 * Deliberately NO `requestIsSameOrigin` check, unlike the POST-based Team
 * routes it otherwise mirrors. That check reads the `Origin` header, and per
 * the Fetch spec browsers only attach `Origin` to a same-origin request when
 * the method is not GET/HEAD — a same-origin `fetch(url)` GET, exactly what
 * this route's own poller sends, arrives with no `Origin` header at all. The
 * check was therefore refusing every single poll with a 403 unconditionally
 * (root cause of realtime sync never firing while F5 still worked, since a
 * full navigation never goes through this route). The session cookie plus
 * `getInternalActorContext()` is the real boundary here, same as it was
 * before this check was added — a plain, side-effect-free GET has no CSRF
 * surface, and the browser's own same-origin policy already stops a foreign
 * page's script from reading this response (no CORS headers are ever sent).
 */
export async function GET(): Promise<Response> {
  const context = await getInternalActorContext().catch(identityFailureResponse);
  if (context instanceof Response) return context;
  if (!context) {
    return Response.json({ ok: false, error: "Session expired." }, { status: 401, headers: NO_STORE });
  }

  // Wolf Forge-only integration (D-285): refuse other Tenants before any cache read.
  if (!isWolfForgeTenant(context.user.tenantId)) {
    return Response.json({ ok: false, error: "Not found." }, { status: 404, headers: NO_STORE });
  }

  const version = await getPodcastSyncVersion();
  return Response.json({ ok: true, version }, { headers: NO_STORE });
}
