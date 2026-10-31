"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CLIENT_SUPPORT_COOKIE, CLIENT_SUPPORT_EXIT_COOKIE, CLIENT_SUPPORT_SECONDS, clientSupportStateSchema, clientSupportTokenSchema } from "../../domain/auth/client-support";
import { hardenAuthCookieOptions } from "../../lib/supabase/auth-cookie-options";
import { clientSupportExitPending, clientSupportRequested } from "../../lib/supabase/client-support";
import { clearSignedOutClientSupport } from "../../lib/supabase/client-support-recovery";
import { createNextServerSupabaseClient, getInternalContext } from "../../lib/supabase/next-server";

export async function beginClientSupportAction(_previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const parsed = z.uuid().safeParse(formData.get("client_profile_id"));
  if (!parsed.success) return { error: "Choose a client portal account." };
  if (await clientSupportRequested() || await clientSupportExitPending()) return { error: "Finish exiting your previous client session first." };
  const context = await getInternalContext();
  if (!['owner', 'admin'].includes(context.user.role) || !context.user.clients.privateManage) {
    return { error: "Client sign-in is available to authorized owners and administrators." };
  }
  const capability = randomBytes(32).toString("hex");
  const result = await context.client.rpc("app_begin_client_support", {
    p_client_id: parsed.data,
    p_capability_hash: createHash("sha256").update(capability).digest("hex"),
  });
  const saved = z.object({ id: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) }).safeParse(result.data);
  if (result.error || !saved.success) return { error: "Client sign-in is unavailable. Check access or try again." };
  (await cookies()).set(CLIENT_SUPPORT_COOKIE, `${saved.data.id}.${capability}`, hardenAuthCookieOptions({
    path: "/", sameSite: "strict" as const, maxAge: CLIENT_SUPPORT_SECONDS,
  }));
  redirect("/account");
}

export async function endClientSupportAction(): Promise<never> {
  if (await clearSignedOutClientSupport()) redirect("/login");
  const cookieStore = await cookies();
  const all = cookieStore.getAll();
  const token = all.find((cookie) => cookie.name === CLIENT_SUPPORT_COOKIE)?.value;
  const pending = all.find((cookie) => cookie.name === CLIENT_SUPPORT_EXIT_COOKIE)?.value;
  const identifier = z.uuid().safeParse(clientSupportTokenSchema.safeParse(token).success ? token!.split(".")[0] : pending);
  const supportId = identifier.success ? identifier.data : null;
  const cookieOptions = hardenAuthCookieOptions({ path: "/", sameSite: "strict" as const, maxAge: CLIENT_SUPPORT_SECONDS });
  // Leaving delegated UI is unconditional; server closure is reported only after readback.
  cookieStore.set(CLIENT_SUPPORT_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  cookieStore.set(CLIENT_SUPPORT_EXIT_COOKIE, supportId ?? "latest", cookieOptions);
  let confirmed = false;
  try {
    const client = await createNextServerSupabaseClient({ support: false });
    const before = await client.rpc("app_get_own_client_support_state", { p_support_id: supportId });
    const state = clientSupportStateSchema.safeParse(before.data);
    if (!before.error && state.success) {
      if (!state.data?.active) confirmed = true;
      else {
        try {
          await client.rpc("app_end_client_support", { p_support_id: state.data.id });
        } catch {
          // A lost response is reconciled by the read below; it is never blindly retried.
        }
        const after = await client.rpc("app_get_own_client_support_state", { p_support_id: state.data.id });
        const saved = clientSupportStateSchema.safeParse(after.data);
        confirmed = !after.error && saved.success && !saved.data?.active;
      }
    }
  } catch {
    // The pending handle permits an authenticated retry without retaining the capability.
  }
  if (confirmed) cookieStore.set(CLIENT_SUPPORT_EXIT_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  redirect(confirmed ? "/clients" : "/client-support/exit?pending=1");
}
