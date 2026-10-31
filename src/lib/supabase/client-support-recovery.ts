import "server-only";

import { cookies } from "next/headers";
import { CLIENT_SUPPORT_COOKIE, CLIENT_SUPPORT_EXIT_COOKIE } from "../../domain/auth/client-support";
import { hardenAuthCookieOptions } from "./auth-cookie-options";
import { getVerifiedSessionContext } from "./next-server";

/** Clear browser-only support state after verified loss of its original Auth session. */
export async function clearSignedOutClientSupport(): Promise<boolean> {
  try {
    if (await getVerifiedSessionContext(false)) return false;
  } catch {
    // An identity outage is not proof that the original session ended.
    return false;
  }
  const store = await cookies();
  const expired = hardenAuthCookieOptions({ path: "/", sameSite: "strict" as const, maxAge: 0 });
  store.set(CLIENT_SUPPORT_COOKIE, "", expired);
  store.set(CLIENT_SUPPORT_EXIT_COOKIE, "", expired);
  return true;
}
