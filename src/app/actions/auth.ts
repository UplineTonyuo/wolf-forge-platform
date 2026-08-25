"use server";

import { redirect } from "next/navigation";
import {
  isCredentialStageFailure,
  resolveSignInSurface,
  signInFailure,
  signInUnassigned,
} from "../../domain/auth/login-flow";
import { safeAccountNextPath, safeNextPath } from "../../domain/auth/safe-next-path";
import {
  createNextServerSupabaseClient,
  readLocalFrontendEnvironment,
  resolveClientUser,
  resolveInternalUser,
} from "../../lib/supabase/next-server";
import { createUserSupabaseClient, verifyActor } from "../../lib/supabase/user-client";

export type LoginState = { error: string | null };

export async function signInAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  // Every credential-stage failure collapses to one message in login-flow.ts.
  // The provider error is passed for intent, never read into the response.
  if (!data.session || isCredentialStageFailure({ error, session: data.session })) {
    return signInFailure(error);
  }

  const client = createUserSupabaseClient(readLocalFrontendEnvironment(), data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  const internalUser = actor ? await resolveInternalUser(client, actor) : null;
  if (resolveSignInSurface({ hasInternalUser: Boolean(internalUser), hasClientUser: false }) === "internal") {
    redirect(safeNextPath(formData.get("next")));
  }

  const clientUser = actor ? await resolveClientUser(client, actor) : null;
  if (resolveSignInSurface({ hasInternalUser: false, hasClientUser: Boolean(clientUser) }) !== "client") {
    await supabase.auth.signOut();
    return signInUnassigned();
  }

  redirect(safeAccountNextPath(formData.get("next")));
}

export async function signOutAction() {
  const supabase = await createNextServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
