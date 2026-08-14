import { z } from "zod";
import type { ClientContactRow } from "../../lib/supabase/database-rows";
import {
  nonBlankTextSchema,
  nullableNonBlankTextSchema,
  uuidSchema,
} from "../shared";

export type ClientContact = ClientContactRow;

const optionalContactText = nullableNonBlankTextSchema.optional();

export const createContactSchema = z.object({
  request_id: uuidSchema.optional(),
  company_id: uuidSchema,
  profile_id: uuidSchema.nullable().optional(),
  name: nonBlankTextSchema,
  email: optionalContactText,
  phone: optionalContactText,
  job_title: optionalContactText,
  is_primary: z.boolean().optional(),
});

export const updateContactSchema = z
  .object({
    profile_id: uuidSchema.nullable().optional(),
    name: nonBlankTextSchema.optional(),
    email: optionalContactText,
    phone: optionalContactText,
    job_title: optionalContactText,
    is_primary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one contact field must be supplied.");

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
