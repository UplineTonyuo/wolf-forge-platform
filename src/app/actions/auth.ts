"use server";

import { redirect } from "next/navigation";
import {
  createNextServerSupabaseClient,
  readLocalFrontendEnvironment,
  resolveClientUser,
  resolveInternalUser,
} from "../../lib/supabase/next-server";
import { createUserSupabaseClient, verifyActor } from "../../lib/supabase/user-client";

export type LoginState = { error: string | null };

function safeNextPath(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" ? value : "/";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export async function signInAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    return { error: "That email and password don't match an account." };
  }

  const client = createUserSupabaseClient(readLocalFrontendEnvironment(), data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  const internalUser = actor ? await resolveInternalUser(client, actor) : null;
  if (internalUser) redirect(safeNextPath(formData.get("next")));

  const clientUser = actor ? await resolveClientUser(client, actor) : null;
  if (!clientUser) {
    await supabase.auth.signOut();
    return { error: "This account is not active or has not been assigned yet." };
  }

  const nextPath = safeNextPath(formData.get("next"));
  redirect(nextPath.startsWith("/account/") ? nextPath : "/account/invoices");
}

export async function signOutAction() {
  const supabase = await createNextServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
