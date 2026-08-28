import { z } from "zod";
import { uuidSchema } from "../shared";

/**
 * Client reporting.
 *
 * A report belongs to one primary delivery lane. SEO package names are not
 * report types: they are open package/template labels underneath seo_package.
 * Report content is structured as ordered sections containing ordered entries;
 * an entry may be native text/status, an external asset, or both.
 */

export const reportLanes = ["seo_package", "gmb_management"] as const;

export const reportLaneSchema = z.enum(reportLanes);
export type ReportLane = z.infer<typeof reportLaneSchema>;

export const reportLaneLabels: Record<ReportLane, string> = {
  seo_package: "SEO Package",
  gmb_management: "GMB Management",
};

export function isReportLane(value: unknown): value is ReportLane {
  return reportLaneSchema.safeParse(value).success;
}

/** An open label, deliberately not an enum, so new service packages need no schema change. */
export const reportPackageLabelSchema = z.string().trim().min(1).max(200);

/**
 * An optional external asset URL, restricted to http(s) whenever it exists.
 *
 * Text/status entries omit this field entirely. Parsing with URL rather than a
 * regexp means a scheme cannot be smuggled past by casing or whitespace.
 */
export const reportUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a report link starting with http:// or https://");

/**
 * A reporting period, stored and transmitted as the first day of the month it
 * names (`YYYY-MM-01`) — matching the Postgres `date` column exactly so
 * neither side has to reinterpret the other's convention.
 */
export const reportingPeriodMonthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-01$/, "Use a first-of-month date (YYYY-MM-01)");

export const reportTitleSchema = z.string().trim().min(1).max(200);
export const reportEntryLabelSchema = z.string().trim().min(1).max(200);
export const reportEntryValueSchema = z.string().trim().min(1).max(4000);
export const reportSortOrderSchema = z.number().int().min(0).max(100_000);
export const reportWizardStepKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Use a lowercase wizard step key");
export const oneTimeReportItemKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Use a lowercase one-time item key");

/**
 * Stable within a report, but intentionally open for custom Phase 2 sections.
 * Known preset keys are defined in presets.ts; the database does not close the
 * system to that catalogue.
 */
export const reportSectionKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Use a lowercase section key");

export const clientReportEntrySchema = z.object({
  label: reportEntryLabelSchema,
  url: reportUrlSchema.nullable().optional(),
  value: reportEntryValueSchema.nullable().optional(),
  sort_order: reportSortOrderSchema,
});

export type ClientReportEntryInput = z.infer<typeof clientReportEntrySchema>;

export const clientReportSectionSchema = z.object({
  section_key: reportSectionKeySchema,
  title: reportTitleSchema,
  sort_order: reportSortOrderSchema,
  entries: z.array(clientReportEntrySchema).max(500),
});

export type ClientReportSectionInput = z.infer<typeof clientReportSectionSchema>;

export function orderReportEntries(
  entries: readonly ClientReportEntryInput[],
): ClientReportEntryInput[] {
  return [...entries].sort((left, right) => left.sort_order - right.sort_order);
}

export function orderReportSections(
  sections: readonly ClientReportSectionInput[],
): ClientReportSectionInput[] {
  return [...sections].sort((left, right) => left.sort_order - right.sort_order);
}

/**
 * Phase 1's existing quick-send path still accepts one external report asset.
 * The database stores that asset as a client_report_entry, never on the report
 * root. Phase 2 can send the full flexible section/entry structure.
 */
export const sendClientReportSchema = z.object({
  request_id: uuidSchema,
  company_id: uuidSchema,
  report_lane: reportLaneSchema,
  package_label: reportPackageLabelSchema,
  title: reportTitleSchema,
  report_url: reportUrlSchema,
});

export type SendClientReportInput = z.infer<typeof sendClientReportSchema>;

/** One row of the client list read model, as app_list_my_client_reports returns it. */
export type ClientReportRow = {
  report_id: string;
  report_lane: string;
  package_label: string;
  title: string;
  /** Transitional Phase 1 primary asset; null is valid for a native-only report. */
  report_url: string | null;
  sent_at: string;
  is_read: boolean;
};

/* -----------------------------------------------------------------------------
 * Phase 2 — the internal builder
 * -------------------------------------------------------------------------- */

/**
 * A report is an internal draft until it is deliberately sent.
 *
 * The database enforces this: a draft has no sent_at, is refused by every
 * client-facing read, and only the send RPC can move a report across.
 */
export const reportStatuses = ["draft", "sent"] as const;

export const reportStatusSchema = z.enum(reportStatuses);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const reportStatusLabels: Record<ReportStatus, string> = {
  draft: "Draft",
  sent: "Sent",
};

/**
 * An editor field that is empty rather than absent.
 *
 * A controlled input holds "" when the operator has not filled it in, and ""
 * is not "no URL" — it is "no URL yet". Collapsing blank to null here means the
 * editor never has to special-case it and the database never stores an empty
 * string. The report-detail RPCs strip null JSON properties, so a missing read
 * property normalizes to that same null rather than becoming a second state.
 */
function blankToNull<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess(
    (value) => (
      value === undefined
        || value === null
        || (typeof value === "string" && value.trim() === "")
        ? null
        : value
    ),
    schema.nullable(),
  );
}

/**
 * One builder entry.
 *
 * Value and URL are independently optional, which is the entire point of the
 * entry model: "Technical SEO / updated" carries no link, "Desktop After /
 * https://..." carries no text, and "Blog Posts / 4 posts completed /
 * https://..." carries both.
 *
 * sort_order is deliberately absent. Array position is the order, in the
 * payload and in the database, so the two cannot disagree.
 */
export const reportDraftEntrySchema = z.object({
  label: reportEntryLabelSchema,
  value: blankToNull(reportEntryValueSchema),
  url: blankToNull(reportUrlSchema),
  one_time_item_key: oneTimeReportItemKeySchema.nullable().optional(),
  one_time_completed: z.boolean().optional(),
}).superRefine((entry, context) => {
  if (entry.one_time_completed && !entry.one_time_item_key) {
    context.addIssue({
      code: "custom",
      path: ["one_time_item_key"],
      message: "A completed one-time item needs its stable item key.",
    });
  }

  if (entry.one_time_completed && !entry.value && !entry.url) {
    context.addIssue({
      code: "custom",
      path: ["one_time_completed"],
      message: "Add a status or link before marking this one-time item complete.",
    });
  }
});

export type ReportDraftEntryInput = z.infer<typeof reportDraftEntrySchema>;

export const maxReportSections = 100;
export const maxSectionEntries = 500;
export const maxReportEntries = 2000;

export const reportDraftSectionSchema = z.object({
  section_key: reportSectionKeySchema,
  title: reportTitleSchema,
  entries: z.array(reportDraftEntrySchema).max(maxSectionEntries),
});

export type ReportDraftSectionInput = z.infer<typeof reportDraftSectionSchema>;

export const reportDraftSectionsSchema = z
  .array(reportDraftSectionSchema)
  .max(maxReportSections)
  .refine(
    (sections) =>
      sections.reduce((total, section) => total + section.entries.length, 0) <=
      maxReportEntries,
    `A report may not exceed ${maxReportEntries} entries.`,
  );

export const createReportDraftSchema = z.object({
  request_id: uuidSchema,
  company_id: uuidSchema,
  service_id: uuidSchema.nullable().optional(),
  subscription_id: uuidSchema.nullable().optional(),
  report_lane: reportLaneSchema,
  package_label: reportPackageLabelSchema,
  title: reportTitleSchema,
  wizard_step_key: reportWizardStepKeySchema.nullable().optional(),
  /** Defaults to the current Wolf Forge business month in the database when omitted. */
  reporting_period_month: reportingPeriodMonthSchema.nullable().optional(),
  sections: reportDraftSectionsSchema,
}).refine(
  (input) => input.subscription_id == null || input.service_id != null,
  { path: ["subscription_id"], message: "A subscription requires a Service." },
);

export type CreateReportDraftInput = z.infer<typeof createReportDraftSchema>;

export const saveReportDraftSchema = z.object({
  report_id: uuidSchema,
  report_lane: reportLaneSchema,
  package_label: reportPackageLabelSchema,
  title: reportTitleSchema,
  wizard_step_key: reportWizardStepKeySchema.nullable().optional(),
  /** Omitted or null leaves the stored reporting period untouched. */
  reporting_period_month: reportingPeriodMonthSchema.nullable().optional(),
  sections: reportDraftSectionsSchema,
});

export type SaveReportDraftInput = z.infer<typeof saveReportDraftSchema>;

export const sendReportDraftSchema = z.object({
  request_id: uuidSchema,
  report_id: uuidSchema,
});

export type SendReportDraftInput = z.infer<typeof sendReportDraftSchema>;

/** One row of the internal workspace list, as app_list_internal_reports returns it. */
export type InternalReportRow = {
  report_id: string;
  company_id: string;
  company_name: string;
  report_lane: string;
  package_label: string;
  title: string;
  status: string;
  section_count: number;
  entry_count: number;
  /** Null for a draft, which has not been sent. */
  sent_at: string | null;
  updated_at: string;
  sent_by_name: string | null;
};

/** One whole report, as app_get_internal_report returns it. */
export type InternalReportDocument = {
  report_id: string;
  company_id: string;
  company_name: string;
  /** Null on legacy quick-send and pre-service-aware drafts. */
  service_id?: string | null;
  service_name?: string | null;
  /** Null is the explicit supported-profile fallback, not a subscription claim. */
  subscription_id?: string | null;
  wizard_step_key?: string | null;
  completed_one_time_item_keys?: string[];
  report_lane: ReportLane;
  package_label: string;
  title: string;
  status: ReportStatus;
  sent_at: string | null;
  updated_at: string;
  /** First day of the calendar month this report covers. Drives the send window. */
  reporting_period_month: string;
  sections: ReportDraftSectionInput[];
};

/**
 * Parses the JSON document the internal report RPC returns.
 *
 * Re-validated rather than cast: the row already passed the RPC and the table
 * constraints, but a render path that trusts a shape it never checked is one
 * schema change away from a runtime crash on a page William is mid-report on.
 */
export const internalReportDocumentSchema = z.object({
  report_id: uuidSchema,
  company_id: uuidSchema,
  company_name: z.string(),
  service_id: uuidSchema.nullable().optional(),
  service_name: z.string().nullable().optional(),
  subscription_id: uuidSchema.nullable().optional(),
  wizard_step_key: reportWizardStepKeySchema.nullable().optional(),
  completed_one_time_item_keys: z.array(oneTimeReportItemKeySchema).optional(),
  report_lane: reportLaneSchema,
  package_label: z.string(),
  title: z.string(),
  status: reportStatusSchema,
  sent_at: z.string().nullable(),
  updated_at: z.string(),
  reporting_period_month: reportingPeriodMonthSchema,
  sections: z.array(reportDraftSectionSchema),
});

/**
 * The client detail uses the same report document shape as the internal
 * builder, narrowed to a delivered report and decorated with this profile's
 * current read state. This is a second read contract, not a second model.
 */
export const clientReportDocumentSchema = internalReportDocumentSchema.extend({
  status: z.literal("sent"),
  sent_at: z.string(),
  is_read: z.boolean(),
});

export type ClientReportDocument = z.infer<typeof clientReportDocumentSchema>;

/**
 * Presentation-only read of the same rule the send RPCs enforce, as
 * app_get_report_send_status returns it. Never authoritative on its own — the
 * send RPC re-checks independently — but lets the editor show the window and
 * disable Send before the operator ever attempts it.
 */
export type ReportSendStatus = {
  can_send: boolean;
  send_anytime: boolean;
  reporting_period_month: string;
  window_start: string;
  window_end: string;
};

/** One Reporting-scoped service row returned after a client is selected. */
export type ReportingServiceOption = {
  service_id: string;
  service_name: string;
  subscription_id: string | null;
  subscription_status: string | null;
};
