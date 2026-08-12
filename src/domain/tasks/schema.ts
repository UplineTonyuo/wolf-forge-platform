import { z } from "zod";
import type { OrderTaskRow } from "../../lib/supabase/database-rows.js";
import {
  nonBlankTextSchema,
  nullableNonBlankTextSchema,
  nullableTimestampSchema,
  uuidSchema,
} from "../shared.js";

export const taskStatuses = ["todo", "in_progress", "blocked", "complete", "canceled"] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type OrderTask = OrderTaskRow;

export const createTaskSchema = z.object({
  request_id: uuidSchema.optional(),
  order_id: uuidSchema,
  assigned_to_profile_id: uuidSchema.nullable().optional(),
  title: nonBlankTextSchema,
  description: nullableNonBlankTextSchema.optional(),
  due_at: nullableTimestampSchema.optional(),
  sort_position: z.number().int().nonnegative().optional(),
});

export const updateTaskSchema = z
  .object({
    title: nonBlankTextSchema.optional(),
    description: nullableNonBlankTextSchema.optional(),
    due_at: nullableTimestampSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one task field must be supplied.");

export const changeTaskStatusSchema = z.object({
  status: taskStatusSchema,
});

export const reorderTaskSchema = z.object({ sort_position: z.number().int().nonnegative() });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ChangeTaskStatusInput = z.infer<typeof changeTaskStatusSchema>;
