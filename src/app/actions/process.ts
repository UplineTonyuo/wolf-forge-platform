"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageProcess, configSchema, savedReplySchema, sections, type ProcessConfig, type ProcessSection } from "../../domain/process/settings";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

export async function saveProcess(section: ProcessSection, version: number, settings: ProcessConfig) {
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("settings");
  if (!canManageProcess(context.user.role)) throw new Error("Workspace administrator access required.");
  const result = await context.client.rpc("app_save_process_config", {
    p_section:z.enum(sections).parse(section), p_version:z.number().int().nonnegative().parse(version), p_settings:configSchema.parse(settings),
  });
  if(result.error) return result.error.code === "40001" ? "Settings changed. Reload before saving." : "Check the entries and workflow settings.";
  revalidatePath("/settings/process/" + section);
  revalidatePath("/(internal)", "layout");
  revalidatePath("/orders","layout");
  return null;
}
export async function savedReplies() {
  const context = await getInternalContext();
  if (!context.user.tickets.reply) throw new Error("Reply permission required.");
  const { data, error } = await context.client.rpc("app_process_entries", { p_section: "saved-replies" });
  if (error) throw new Error("Saved replies could not be loaded.");
  return savedReplySchema.array().parse(data);
}
export async function setResourceTag(kind: "projects"|"tickets"|"clients", target: string, tag: string, add: boolean) {
  const context = await getInternalContext();
  z.enum(["projects","tickets","clients"]).parse(kind);
  if (!context.user[kind].edit) throw new Error("Editing permission required.");
  const {error} = await context.client.rpc("app_tag_resource",{p_kind:kind,p_target:z.uuid().parse(target),p_tag:z.uuid().parse(tag),p_add:z.boolean().parse(add)});
  if(error) throw new Error("Tag update refused.");
  revalidatePath("/" + (kind==="projects" ? "orders" : kind) + "/" + target,"layout");
}
export async function requestClientRevision(orderId: string, completedAt: string, requestId: string, reason: string) {
  const context = await getClientContext();
  if (context.actor.support) throw new Error("Client identity required.");
  const result = await context.client.rpc("app_request_order_revision", {
    p_order: z.uuid().parse(orderId),
    p_reason: z.string().trim().min(1).max(4000).parse(reason),
    p_expected_completed_at: z.iso.datetime({offset: true}).parse(completedAt),
    p_request_id: z.uuid().parse(requestId),
  });
  if (result.error) {
    if (result.error.code === "40001") return { error: "This order has changed. Reload it to check its current completion." } as const;
    if (result.error.code === "22023") return { error: "The revision request changed. Reload the order before submitting again." } as const;
    if (result.error.code === "42501" || result.error.code === "23514") {
      return { error: "Revisions are unavailable for this order. Reload it to check the current options." } as const;
    }
    return { error: "Could not confirm the revision. Try submitting it again." } as const;
  }
  const receipt = z.object({ revision_id: z.uuid(), destination: z.string() }).parse(result.data);
  revalidatePath("/orders","layout");
  revalidatePath("/account/projects","layout");
  return { receipt } as const;
}
export async function submitClientRating(section: "orders"|"tickets", target: string, form: FormData) {
  const context = await getClientContext();
  z.uuid().parse(target);
  z.enum(["orders","tickets"]).parse(section);
  if(context.actor.support) throw new Error("Client identity required.");
  const result = await context.client.rpc("app_client_process",{p_section:section,p_target:target,p_score:z.coerce.number().int().min(1).max(5).parse(form.get("score"))});
  if(result.error) throw new Error("Request refused. Reload to check the current status.");
  revalidatePath("/orders","layout");
  revalidatePath("/account/projects","layout");
  revalidatePath("/account/messages/" + target);
}

