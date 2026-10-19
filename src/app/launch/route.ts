import { IdentityLookupError } from "../../lib/supabase/identity-lookup";
import { identityFailureResponse } from "../../lib/supabase/identity-failure-response";
import { getVerifiedSessionContext, resolveClientUser, resolveInternalUser } from "../../lib/supabase/next-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let destination = "/login";
  try {
    const context = await getVerifiedSessionContext();
    if (context) {
      if (await resolveInternalUser(context.client, context.actor)) destination = "/";
      else if (await resolveClientUser(context.client, context.actor)) destination = "/account";
    }
  } catch (error) {
    if (!(error instanceof IdentityLookupError)) throw error;
    if (error.kind === "unavailable") destination = "/login?reason=identity-unavailable";
    else return identityFailureResponse(error);
  }
  return new Response(null, {
    status: 307,
    headers: { location: new URL(destination, request.url).href, "cache-control": "private, no-store, max-age=0" },
  });
}
