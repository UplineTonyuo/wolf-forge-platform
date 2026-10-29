"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getInternalContext } from "../../lib/supabase/next-server";
import { PermissionDeniedError, toClientSafeError } from "../../lib/errors/application-error";
import { taskStatusSchema } from "../../domain/tasks/schema";

const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), title: z.string().trim().min(1).max(500), requestId: z.uuid() }).strict(),
  z.object({ kind: z.literal("rename"), taskId: z.uuid(), title: z.string().trim().min(1).max(500) }).strict(),
  z.object({ kind: z.literal("status"), taskId: z.uuid(), status: taskStatusSchema }).strict(),
  z.object({ kind: z.literal("assign"), taskId: z.uuid(), profileId: z.uuid().nullable() }).strict(),
]);
export type ProjectTaskCommand = z.infer<typeof commandSchema>;

export async function manageProjectTaskAction(orderId: string, input: ProjectTaskCommand): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const id = z.uuid().parse(orderId), command = commandSchema.parse(input);
    const context = await getInternalContext();
    await context.services.permissions.requireModuleAccess("projects");
    if (!context.user.projects.edit || (command.kind === "assign" && !context.user.projects.assign)) throw new PermissionDeniedError();
    const order = await context.services.orders.get(id);
    if (order.archived_at) throw new PermissionDeniedError();
    if (command.kind === "create") {
      await context.services.tasks.create({ order_id: id, title: command.title, request_id: command.requestId }, context.actor);
    } else {
      const task = await context.services.tasks.get(command.taskId);
      if (task.order_id !== id || task.archived_at) throw new PermissionDeniedError();
      if (command.kind === "rename") await context.services.tasks.update(task.id, { title: command.title }, context.actor);
      else if (command.kind === "status") await context.services.tasks.changeStatus(task.id, { status: command.status }, context.actor);
      else if (command.kind === "assign") await context.services.tasks.assign(task.id, command.profileId, context.actor);
    }
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (error) { return { ok: false, error: toClientSafeError(error).message }; }
}
