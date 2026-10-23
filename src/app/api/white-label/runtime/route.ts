import { toClientSafeError } from "../../../../lib/errors/application-error";
import { identityFailureResponse } from "../../../../lib/supabase/identity-failure-response";
import { IdentityLookupError } from "../../../../lib/supabase/identity-lookup";
import { getVerifiedSessionContext } from "../../../../lib/supabase/next-server";
import { WhiteLabelPublicationRepository } from "../../../../repositories/white-label-publication-repository";
import { WhiteLabelPublicationService } from "../../../../services/white-label-publication-service";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    const context = await getVerifiedSessionContext();
    if (!context) return identityFailureResponse(new IdentityLookupError("unauthenticated", "session"));
    const configuration = await new WhiteLabelPublicationService({
      repository: new WhiteLabelPublicationRepository(context.client),
    }).getRuntimeConfiguration();
    return Response.json(configuration, {
      headers: { ...headers, "x-wf-branding-actor": context.actor.id },
    });
  } catch (error) {
    if (error instanceof IdentityLookupError) return identityFailureResponse(error);
    const safe = toClientSafeError(error);
    const denied = safe.code === "PERMISSION_DENIED" || safe.code === "NOT_FOUND";
    return Response.json({ ok: false, error: denied ? "Access refused." : "Workspace branding is unavailable." }, {
      status: denied ? 403 : 503, headers,
    });
  }
}
