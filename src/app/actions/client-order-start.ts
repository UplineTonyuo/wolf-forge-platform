"use server";
import { revalidatePath } from "next/cache";
import { getClientContext } from "../../lib/supabase/next-server";
import { toClientSafeError } from "../../lib/errors/application-error";

export async function requestClientOrderStart(orderId: string) {
  const context = await getClientContext();
  try {
    const state = await context.services.projects.requestClientStart(orderId, context.actor);
    revalidatePath(`/account/projects/${state.order_id}`);
    revalidatePath("/account/projects"); revalidatePath("/account");
    revalidatePath("/orders"); revalidatePath("/dashboard");
    return { ok: true as const, state };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}
