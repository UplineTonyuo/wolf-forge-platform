import { z } from "zod";
import type { CompanyRow } from "../../lib/supabase/database-rows";
import { nonBlankTextSchema, uuidSchema } from "../shared";

export type Company = CompanyRow;

export const companyStatuses = [
  "contact",
  "lead",
  "client",
  "client_team",
] as const;

export const companyStatusSchema = z.enum(companyStatuses);

export type CompanyStatus = z.infer<
  typeof companyStatusSchema
>;

export const companyNameSchema = nonBlankTextSchema.max(200);

export const createCompanySchema = z.object({
  request_id: uuidSchema.optional(),
  name: companyNameSchema,
});

export const updateCompanySchema = z
  .object({
    name: companyNameSchema.optional(),
    status: companyStatusSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one company field must be supplied.",
  );

export type CreateCompanyInput = z.infer<
  typeof createCompanySchema
>;

export type UpdateCompanyInput = z.infer<
  typeof updateCompanySchema
>;
