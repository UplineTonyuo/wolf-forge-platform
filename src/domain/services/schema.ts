import { z } from "zod";
import type { ServiceRow } from "../../lib/supabase/database-rows.js";
import { nonBlankTextSchema, nullableNonBlankTextSchema, uuidSchema } from "../shared.js";

export type Service = ServiceRow;

export const createServiceSchema = z.object({
  request_id: uuidSchema.optional(),
  name: nonBlankTextSchema,
  description: nullableNonBlankTextSchema.optional(),
  is_active: z.boolean().optional(),
});

export const updateServiceSchema = z.object({
  name: nonBlankTextSchema.optional(),
  description: nullableNonBlankTextSchema.optional(),
  is_active: z.boolean().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one service field must be supplied.",
);

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
