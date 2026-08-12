import { z } from "zod";
import type { CompanyRow } from "../../lib/supabase/database-rows.js";
import { nonBlankTextSchema, uuidSchema } from "../shared.js";

export type Company = CompanyRow;

export const createCompanySchema = z.object({
  request_id: uuidSchema.optional(),
  name: nonBlankTextSchema,
});

export const updateCompanySchema = z.object({ name: nonBlankTextSchema.optional() }).refine(
  (value) => Object.keys(value).length > 0,
  "At least one company field must be supplied.",
);

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
