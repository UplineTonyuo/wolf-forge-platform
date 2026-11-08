import { z } from "zod";

export const orderReportRequirementSchema = z.object({
  orderId: z.uuid(),
  companyId: z.uuid(),
  serviceId: z.uuid(),
  serviceName: z.string().min(1).max(500),
  reportingPeriodMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-01$/u),
  canRecordException: z.boolean(),
});
export type OrderReportRequirement = z.infer<typeof orderReportRequirementSchema>;
export const reportSetupScopeSchema = orderReportRequirementSchema.pick({ companyId: true, serviceId: true, reportingPeriodMonth: true });
export type ReportSetupScope = z.infer<typeof reportSetupScopeSchema>;

export const reportExceptionSchema = orderReportRequirementSchema.pick({ serviceId: true, reportingPeriodMonth: true }).extend({
  reason: z.string().trim().min(1, "Enter a reason.").max(1000),
});
export type ReportExceptionInput = z.infer<typeof reportExceptionSchema>;

export function reportCompletionMonthLabel(month: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
}

export function reportCompletionHref(scope: OrderReportRequirement): string {
  const query = new URLSearchParams({ companyId: scope.companyId, serviceId: scope.serviceId, reportingPeriodMonth: scope.reportingPeriodMonth });
  return `/reporting/new?${query}`;
}
