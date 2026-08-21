import { z } from "zod";
import type { Json } from "../../lib/supabase/database.types";
import type { ActivityEventRow } from "../../lib/supabase/database-rows";
import { nonBlankTextSchema, timestampSchema, uuidSchema } from "../shared";

export const activityEntityTypes = [
  "company",
  "client_contact",
  "service",
  "order",
  "order_task",
  "profile",
  "ticket",
] as const;
export const activityEntityTypeSchema = z.enum(activityEntityTypes);

export const activityActions = [
  "company.created",
  "company.updated",
  "company.archived",
  "contact.created",
  "contact.updated",
  "contact.archived",
  "service.created",
  "service.updated",
  "service.archived",
  "order.created",
  "order.updated",
  "order.status_changed",
  "order.assigned",
  "order.archived",
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "ticket.created",
  "ticket.replied",
  "ticket.internal_note_added",
  "ticket.assigned",
  "ticket.status_changed",
  "ticket.priority_changed",
  "ticket.archived",
] as const;
export const activityActionSchema = z.enum(activityActions);

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);
const metadataSchema = z.record(z.string(), jsonSchema);

const activityBaseSchema = z.object({
  entity_type: activityEntityTypeSchema,
  entity_id: uuidSchema,
  action: activityActionSchema,
  summary: nonBlankTextSchema,
  metadata: metadataSchema.optional(),
});

/*
 * There is no user-authored activity schema. Browser sessions hold no INSERT
 * privilege on public.activity_events (M-02): an authenticated action reaches
 * the audit stream only through a trusted SECURITY DEFINER RPC or trigger that
 * derives the actor and timestamp server-side.
 */
export const systemActivitySchema = activityBaseSchema.extend({
  actor_profile_id: uuidSchema.nullable().optional(),
  created_at: timestampSchema.optional(),
});

export type ActivityEvent = ActivityEventRow;
export type SystemActivityInput = z.infer<typeof systemActivitySchema>;
