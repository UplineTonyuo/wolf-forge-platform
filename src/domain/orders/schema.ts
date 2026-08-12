import { z } from "zod";
import type { OrderRow } from "../../lib/supabase/database-rows.js";
import {
  nonBlankTextSchema,
  nullableNonBlankTextSchema,
  nullableTimestampSchema,
  uuidSchema,
} from "../shared.js";

export const orderStatuses = [
  "pending",
  "submitted",
  "working",
  "waiting_reply",
  "pending_update",
  "complete",
  "canceled",
] as const;
export const orderPriorities = ["low", "normal", "high", "urgent"] as const;

export const orderStatusSchema = z.enum(orderStatuses);
export const orderPrioritySchema = z.enum(orderPriorities);
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderPriority = z.infer<typeof orderPrioritySchema>;
export type Order = OrderRow;

export const createOrderSchema = z.object({
  request_id: uuidSchema.optional(),
  company_id: uuidSchema,
  service_id: uuidSchema,
  assigned_to_profile_id: uuidSchema.nullable().optional(),
  title: nonBlankTextSchema,
  priority: orderPrioritySchema.optional(),
  due_at: nullableTimestampSchema.optional(),
  started_at: nullableTimestampSchema.optional(),
  notes: nullableNonBlankTextSchema.optional(),
});

export const updateOrderSchema = z
  .object({
    service_id: uuidSchema.optional(),
    title: nonBlankTextSchema.optional(),
    priority: orderPrioritySchema.optional(),
    due_at: nullableTimestampSchema.optional(),
    started_at: nullableTimestampSchema.optional(),
    notes: nullableNonBlankTextSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one order field must be supplied.");

export const changeOrderStatusSchema = z.object({
  status: orderStatusSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ChangeOrderStatusInput = z.infer<typeof changeOrderStatusSchema>;
