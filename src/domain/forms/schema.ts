import { z } from "zod";
import type {
  FormAssignmentRow,
  FormFieldOptionRow,
  FormFileRow,
  FormRow,
  FormRuleRow,
  FormServiceLinkRow,
  FormSubmissionRow,
  FormSubmissionValueRow,
  FormVersionFieldRow,
  FormVersionRow,
} from "../../lib/supabase/database-rows";
import type { Json } from "../../lib/supabase/database.types";
import { uuidSchema } from "../shared";

export const formTypes = ["order", "contact", "intake", "onboarding"] as const;
export const formStatuses = ["draft", "published", "inactive", "archived"] as const;
export const formVisibilities = ["public", "authenticated", "assigned"] as const;
export const formFieldTypes = [
  "optgroup", "dropdown", "fullname", "email", "password", "address", "phone",
  "optin", "payment", "text", "textarea", "richtext", "date", "checkbox",
  "data-option-group", "data-dropdown", "file", "data-spreadsheet", "secret",
  "hidden", "signature", "calendly", "break", "pagebreak", "html", "captcha",
] as const;
export const formRuleComparators = ["equals", "not_equals", "checked", "not_checked"] as const;

export const formCanonicalKeySchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const unsafeHtmlPattern = /<\s*(?:script|iframe|object|embed|style|link|meta|svg)(?:\s|>)|\son[a-z]+\s*=|(?:javascript|vbscript|data)\s*:/iu;
const safeHtmlSchema = z.string().max(100_000).refine(
  (value) => !unsafeHtmlPattern.test(value),
  "Executable or unsafe HTML is not allowed.",
);
const jsonObjectSchema = z.record(z.string(), z.json());

export const formFieldOptionSchema = z.object({
  stable_option_key: uuidSchema,
  option_value: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(500),
  sort_order: z.number().int().nonnegative(),
  metadata: jsonObjectSchema.default({}),
}).strict();

export const formServiceLinkSchema = z.object({
  service_id: uuidSchema,
  role: z.enum(["offered_item", "default_item", "intake_assignment"]),
  sort_order: z.number().int().nonnegative().default(0),
  configuration: jsonObjectSchema.default({}),
}).strict();

export const formFieldSchema = z.object({
  stable_field_key: uuidSchema,
  sort_order: z.number().int().nonnegative(),
  field_type: z.enum(formFieldTypes),
  label: z.string().trim().min(1).max(500),
  internal_label: z.string().trim().min(1).max(500).nullable().optional(),
  placeholder: z.string().trim().min(1).max(1_000).nullable().optional(),
  help_html: safeHtmlSchema.nullable().optional(),
  default_value: z.json().nullable().optional(),
  required: z.boolean().default(false),
  settings: jsonObjectSchema.default({}),
  options: z.array(formFieldOptionSchema).default([]),
  service_links: z.array(formServiceLinkSchema).default([]),
}).strict().superRefine((field, context) => {
  if (field.field_type === "secret"
    && (field.required || field.settings.collection_mode !== "disabled")) {
    context.addIssue({
      code: "custom",
      path: ["settings", "collection_mode"],
      message: "Secret collection stays disabled until encrypted storage exists.",
    });
  }
  if (field.field_type === "html") {
    const html = field.settings.html;
    if (typeof html !== "string" || unsafeHtmlPattern.test(html)) {
      context.addIssue({
        code: "custom",
        path: ["settings", "html"],
        message: "Custom HTML must be present and non-executable.",
      });
    }
  }
});

export const formRuleSchema = z.object({
  rule_key: uuidSchema,
  sort_order: z.number().int().nonnegative(),
  conditions: z.array(z.object({
    field_key: uuidSchema,
    comparator: z.enum(formRuleComparators),
    value: z.json().optional(),
  }).strict()).min(1),
  action: z.enum(["show", "hide"]),
  target_field_keys: z.array(uuidSchema).min(1),
}).strict();

export const formDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  information_html: safeHtmlSchema.nullable().optional(),
  visibility: z.enum(formVisibilities),
  type_config: jsonObjectSchema.default({}),
  fields: z.array(formFieldSchema).min(1).max(500),
  rules: z.array(formRuleSchema).max(500).default([]),
  service_links: z.array(formServiceLinkSchema).max(500).default([]),
}).strict().superRefine((definition, context) => {
  const fieldKeys = definition.fields.map((field) => field.stable_field_key);
  if (new Set(fieldKeys).size !== fieldKeys.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Field keys must be unique." });
  }
  const sortOrders = definition.fields.map((field) => field.sort_order);
  if (new Set(sortOrders).size !== sortOrders.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Field order must be unique." });
  }
});

function validateTypeBoundary(
  formType: (typeof formTypes)[number],
  definition: z.infer<typeof formDefinitionSchema>,
  context: z.RefinementCtx,
) {
  const assignedType = formType === "intake" || formType === "onboarding";
  if (assignedType !== (definition.visibility === "assigned")) {
    context.addIssue({
      code: "custom",
      path: ["definition", "visibility"],
      message: "Intake and Onboarding Forms must use assigned visibility.",
    });
  }
  definition.fields.forEach((field, index) => {
    if (["optgroup", "dropdown", "payment"].includes(field.field_type) && formType !== "order") {
      context.addIssue({
        code: "custom",
        path: ["definition", "fields", index, "field_type"],
        message: "This field type is available only on Order Forms.",
      });
    }
  });
}

export const createFormSchema = z.object({
  request_id: uuidSchema,
  form_type: z.enum(formTypes),
  canonical_key: formCanonicalKeySchema,
  definition: formDefinitionSchema,
}).strict().superRefine((input, context) => {
  validateTypeBoundary(input.form_type, input.definition, context);
});

export const updateFormDraftSchema = z.object({
  request_id: uuidSchema,
  definition: formDefinitionSchema,
}).strict();

export const formRequestSchema = z.object({ request_id: uuidSchema }).strict();

export const assignFormSchema = z.object({
  request_id: uuidSchema,
  context: z.union([
    z.object({
      order_id: uuidSchema,
      required: z.boolean().default(true),
      due_at: z.iso.datetime({ offset: true }).nullable().optional(),
    }).strict(),
    z.object({
      client_profile_id: uuidSchema,
      required: z.boolean().default(true),
      due_at: z.iso.datetime({ offset: true }).nullable().optional(),
    }).strict(),
  ]),
}).strict();

export const formSubmissionValueSchema = z.object({
  field_key: uuidSchema,
  value: z.json(),
}).strict();

export const submitFormSchema = z.object({
  request_id: uuidSchema,
  form_version_id: uuidSchema,
  context: z.object({
    assignment_id: uuidSchema.optional(),
    order_id: uuidSchema.optional(),
    company_id: uuidSchema.optional(),
    client_profile_id: uuidSchema.optional(),
  }).strict().default({}),
  values: z.array(formSubmissionValueSchema).max(500),
  files: z.array(z.never()).default([]),
}).strict().superRefine((input, context) => {
  const keys = input.values.map((value) => value.field_key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["values"], message: "Field values cannot repeat." });
  }
});

export const correctFormSubmissionSchema = z.object({
  request_id: uuidSchema,
  values: z.array(formSubmissionValueSchema).max(500),
}).strict();

export type Form = FormRow;
export type FormVersion = FormVersionRow;
export type FormVersionField = FormVersionFieldRow;
export type FormFieldOption = FormFieldOptionRow;
export type FormRule = FormRuleRow;
export type FormServiceLink = FormServiceLinkRow;
export type FormAssignment = FormAssignmentRow;
export type FormSubmission = FormSubmissionRow;
export type FormSubmissionValue = FormSubmissionValueRow;
export type FormFile = FormFileRow;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type CreateFormInput = z.infer<typeof createFormSchema>;
export type UpdateFormDraftInput = z.infer<typeof updateFormDraftSchema>;
export type FormRequestInput = z.infer<typeof formRequestSchema>;
export type AssignFormInput = z.infer<typeof assignFormSchema>;
export type SubmitFormInput = z.infer<typeof submitFormSchema>;
export type CorrectFormSubmissionInput = z.infer<typeof correctFormSubmissionSchema>;

export type FormDetail = {
  form: FormRow;
  versions: FormVersionRow[];
  draftDefinition: FormDefinition;
};

export type FormCapabilities = {
  view: boolean;
  manage: boolean;
  publish: boolean;
  assign: boolean;
  submissionsView: boolean;
  submissionsManage: boolean;
};

export type FormSchemaField = {
  stable_field_key: string;
  sort_order: number;
  field_type: (typeof formFieldTypes)[number];
  label: string;
  placeholder: string | null;
  help_html: string | null;
  default_value: Json | null;
  required: boolean;
  settings: Record<string, Json | undefined>;
  options: Array<{
    option_id: string;
    value: string;
    label: string;
    sort_order: number;
    metadata: Record<string, Json | undefined>;
  }>;
  services: Array<{
    service_id: string;
    role: "offered_item" | "default_item" | "intake_assignment";
    sort_order: number;
    configuration: Record<string, Json | undefined>;
    name: string;
    currency: string;
    price_cents: number;
  }>;
};

export type FormPublishedSchema = {
  form_id: string;
  form_type: (typeof formTypes)[number];
  canonical_key: string;
  form_version_id: string;
  version_number: number;
  schema_hash: string | null;
  title: string;
  information_html: string | null;
  visibility: (typeof formVisibilities)[number];
  type_config: Record<string, Json | undefined>;
  fields: FormSchemaField[];
  rules: z.infer<typeof formRuleSchema>[];
};

export type FormAssignmentSummary = {
  assignment_id: string;
  form_id: string;
  form_type: "intake" | "onboarding";
  form_version_id: string;
  version_number: number;
  title: string;
  status: "assigned" | "submitted" | "archived" | "canceled";
  required: boolean;
  due_at: string | null;
  assigned_at: string;
  completed_at: string | null;
  company_id: string;
  company_name: string;
  client_profile_id: string | null;
  client_name: string | null;
  order_id: string | null;
  order_number: string | null;
  order_title: string | null;
  latest_submission_id: string | null;
};

export type AssignedFormDetail = {
  assignment: FormAssignmentSummary;
  schema: FormPublishedSchema;
};

export type FormSubmissionSummary = {
  id: string;
  form_id: string;
  form_version_id: string;
  form_assignment_id: string | null;
  company_id: string | null;
  client_profile_id: string | null;
  order_id: string | null;
  revision_number: number;
  status: string;
  submitted_at: string;
  submitted_by_profile_id: string | null;
  supersedes_submission_id: string | null;
};

export type FormSubmissionDetail = {
  submission: FormSubmissionRow;
  values: Array<{
    stable_field_key: string;
    label: string;
    field_type: string;
    sort_order: number;
    value: Json;
  }>;
};
