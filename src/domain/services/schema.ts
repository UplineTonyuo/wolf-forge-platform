import { z } from "zod";
import type { ServiceFolderRow, ServiceRow } from "../../lib/supabase/database-rows";
import { nonBlankTextSchema, nullableNonBlankTextSchema, uuidSchema } from "../shared";

export type Service = ServiceRow;
export type ServiceFolder = ServiceFolderRow;

export const recurringIntervalUnits = ["D", "W", "M", "Y"] as const;
export const recurringActions = ["none", "reopen_order", "create_order", "client_request"] as const;
export const deadlineUnits = ["H", "D"] as const;

const moneySchema = z.number().finite().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const sortOrderSchema = z.number().int().nonnegative();
const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code.");
const safeRemoteImageUrlSchema = z.string().trim().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}, "Use an http:// or https:// image URL.");

const serviceFieldsSchema = z.object({
  name: nonBlankTextSchema,
  folder_id: uuidSchema.nullable().optional(),
  description: nullableNonBlankTextSchema.optional(),
  price: moneySchema.optional(),
  currency: currencySchema.optional(),
  image_url: safeRemoteImageUrlSchema.nullable().optional(),
  is_active: z.boolean().optional(),
  is_public: z.boolean().optional(),
  recurring: z.boolean().optional(),
  recurring_price: moneySchema.nullable().optional(),
  recurring_interval_length: positiveIntegerSchema.nullable().optional(),
  recurring_interval_unit: z.enum(recurringIntervalUnits).nullable().optional(),
  recurring_action: z.enum(recurringActions).nullable().optional(),
  group_quantities: z.boolean().optional(),
  assigned_to_profile_id: uuidSchema.nullable().optional(),
  deadline_amount: positiveIntegerSchema.nullable().optional(),
  deadline_unit: z.enum(deadlineUnits).nullable().optional(),
  require_client_profile: z.boolean().optional(),
  sort_order: sortOrderSchema.optional(),
  subscription_eligible: z.boolean().optional(),
});

function validateServiceConfiguration(
  value: {
    recurring?: boolean;
    recurring_price?: number | null;
    recurring_interval_length?: number | null;
    recurring_interval_unit?: (typeof recurringIntervalUnits)[number] | null;
    recurring_action?: (typeof recurringActions)[number] | null;
    deadline_amount?: number | null;
    deadline_unit?: (typeof deadlineUnits)[number] | null;
  },
  context: z.RefinementCtx,
) {
  const recurrenceValues = [
    value.recurring_price,
    value.recurring_interval_length,
    value.recurring_interval_unit,
    value.recurring_action,
  ];

  if (value.recurring && recurrenceValues.some((candidate) => candidate == null)) {
    context.addIssue({
      code: "custom",
      path: ["recurring"],
      message: "Recurring services require a price, interval, and action.",
    });
  }

  if (value.recurring === false && recurrenceValues.some((candidate) => candidate != null)) {
    context.addIssue({
      code: "custom",
      path: ["recurring"],
      message: "Disable recurring settings when the service is not recurring.",
    });
  }

  if ((value.deadline_amount == null) !== (value.deadline_unit == null)) {
    context.addIssue({
      code: "custom",
      path: ["deadline_amount"],
      message: "Deadline amount and unit must be supplied together.",
    });
  }
}

export const createServiceSchema = serviceFieldsSchema
  .extend({
    request_id: uuidSchema.optional(),
    price: moneySchema.default(0),
    currency: currencySchema.default("USD"),
    is_active: z.boolean().default(true),
    is_public: z.boolean().default(true),
    recurring: z.boolean().default(false),
    group_quantities: z.boolean().default(false),
    require_client_profile: z.boolean().default(false),
    sort_order: sortOrderSchema.default(0),
  })
  .superRefine(validateServiceConfiguration);

export const updateServiceSchema = serviceFieldsSchema
  .partial()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one service field must be supplied.",
      });
      return;
    }
    validateServiceConfiguration(value, context);
  });

export const createServiceFolderSchema = z.object({
  request_id: uuidSchema.optional(),
  name: nonBlankTextSchema,
  description: nullableNonBlankTextSchema.optional(),
  parent_id: uuidSchema.nullable().optional(),
  sort_order: sortOrderSchema.default(0),
});

export const updateServiceFolderSchema = z.object({
  name: nonBlankTextSchema.optional(),
  description: nullableNonBlankTextSchema.optional(),
  parent_id: uuidSchema.nullable().optional(),
  sort_order: sortOrderSchema.optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one folder field must be supplied.",
);

export type CreateServiceInput = z.input<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type CreateServiceFolderInput = z.input<typeof createServiceFolderSchema>;
export type UpdateServiceFolderInput = z.infer<typeof updateServiceFolderSchema>;
