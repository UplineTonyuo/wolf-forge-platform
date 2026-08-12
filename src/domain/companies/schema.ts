import { z } from "zod";
import type { CompanyRow } from "../../lib/supabase/database.types.js";
import { nonBlankTextSchema } from "../shared.js";

export type Company = CompanyRow;

export const createCompanySchema = z.object({
  name: nonBlankTextSchema,
});

export const updateCompanySchema = createCompanySchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one company field must be supplied.",
);

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
