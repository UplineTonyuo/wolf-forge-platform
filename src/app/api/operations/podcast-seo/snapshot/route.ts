import { loadPodcastWorkflowSnapshotBundleOrNull } from "../../../../../services/podcast-workflow-service";
import { getInternalActorContext } from "../../../../../lib/supabase/next-server";
import { identityFailureResponse } from "../../../../../lib/supabase/identity-failure-response";
import { isWolfForgeTenant } from "../../../../../domain/tenancy/wolf-forge-tenant";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store, max-age=0" };

/**
 * The client-triggered refetch behind a live-invalidation event. This is a
 * GET with no request body — nothing the caller sends is trusted as
 * workflow data, it only re-reads Google Sheets through the same read-only,
 * cache-tagged path the initial page load uses
 * (`loadPodcastWorkflowSnapshotOrNull`). Same authorization boundary as the
 * page itself: `getInternalActorContext()`, the full internal-role check,
 * not the lighter Team one — this surfaces the same data the page does, and
 * has no per-actor database recheck behind it the way Team's RPCs do.
 *
 * Deliberately NO `requestIsSameOrigin` check — see the matching comment on
 * `/api/operations/podcast-seo/version`. Browsers omit the `Origin` header
 * on a same-origin GET, so that check refused every real poll/refetch with a
 * 403 and was the reason automatic sync never fired while a full page
 * reload (which never calls this route) still worked. The session cookie
 * plus `getInternalActorContext()` remains the real boundary; a read with no
 * side effects has no CSRF surface, and this route never sends CORS headers,
 * so no foreign page's script can read the response either way.
 *
 * `?month=` is untrusted input, exactly like the page's own `searchParams`
 * — it flows through the same `getSnapshotForMonth` resolution against the
 * source's freshly-discovered allowlist, so a background refresh honors
 * whichever month the viewer currently has selected instead of silently
 * reverting to the newest one.
 */
export async function GET(request: Request): Promise<Response> {
  const context = await getInternalActorContext().catch(identityFailureResponse);
  if (context instanceof Response) return context;
  if (!context) {
    return Response.json({ ok: false, error: "Session expired." }, { status: 401, headers: NO_STORE });
  }

  // Wolf Forge-only integration (D-285): refuse other Tenants before any cache read.
  if (!isWolfForgeTenant(context.user.tenantId)) {
    return Response.json({ ok: false, error: "Not found." }, { status: 404, headers: NO_STORE });
  }

  const month = new URL(request.url).searchParams.get("month");

  try {
    const bundle = await loadPodcastWorkflowSnapshotBundleOrNull(month);
    return Response.json(
      {
        ok: true,
        data: bundle
          ? {
              items: bundle.snapshot.items,
              sourceMonth: bundle.snapshot.sourceMonth,
              lastSyncedAt: bundle.snapshot.lastSyncedAt,
              vaOptions: bundle.snapshot.vaOptions,
              monthOptions: bundle.monthOptions,
              selectedMonth: bundle.selectedMonth,
            }
          : null,
      },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { ok: false, error: "The Podcast SEO workflow could not be refreshed." },
      { status: 500, headers: NO_STORE },
    );
  }
}
