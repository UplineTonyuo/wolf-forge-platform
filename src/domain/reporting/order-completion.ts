import { z } from "zod";

const workMonthSchema = z.string().regex(/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-01$/u);
export const reportCompletionScopeSchema = z.object({
  serviceId: z.uuid(),
  reportingPeriodMonth: workMonthSchema,
});
export type ReportCompletionScope = z.infer<typeof reportCompletionScopeSchema>;

export const orderReportRequirementSchema = z.object({
  orderId: z.uuid(),
  companyId: z.uuid(),
  serviceId: z.uuid(),
  serviceName: z.string().min(1).max(500),
  reportingPeriodMonth: workMonthSchema.nullable(),
  canRecordException: z.boolean(),
});
export type OrderReportRequirement = z.infer<typeof orderReportRequirementSchema>;
export const reportSetupScopeSchema = reportCompletionScopeSchema.extend({ companyId: z.uuid() });
export type ReportSetupScope = z.infer<typeof reportSetupScopeSchema>;

export const reportExceptionSchema = reportCompletionScopeSchema.extend({
  reason: z.string().trim().min(1, "Enter a reason.").max(1000),
});
export type ReportExceptionInput = z.infer<typeof reportExceptionSchema>;

export function reportCompletionMonthLabel(month: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
}

export function reportCompletionHref(scope: ReportSetupScope): string {
  const query = new URLSearchParams({ companyId: scope.companyId, serviceId: scope.serviceId, reportingPeriodMonth: scope.reportingPeriodMonth });
  return `/reporting/new?${query}`;
}
