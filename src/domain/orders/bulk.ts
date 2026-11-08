import { z } from "zod";
import { OrderReportRequiredError, ValidationError, toClientSafeError } from "../../lib/errors/application-error";
import type { OrderReportRequirement } from "../reporting/order-completion";

export type ProjectOutcome = {
  id: string;
  label: string;
  error?: string;
  completionRequirement?: OrderReportRequirement;
};

/**
 * Bulk Projects work is a sequence of individually audited per-project calls.
 * It is deliberately NOT atomic, so every project reports its own outcome and a
 * partial failure can never be presented as overall success.
 */
export type ProjectBulkResult = {
  attempted: number;
  succeeded: ProjectOutcome[];
  failed: ProjectOutcome[];
};

export const unavailableProjectLabel = "Unavailable project";

// Internal request bound: each selected Project can cause a separate database call.
export const projectBatchSizeLimit = 50;
const projectBatchIdsSchema = z.array(z.uuid()).max(projectBatchSizeLimit);

export function parseProjectBatchIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > projectBatchSizeLimit) {
    throw new ValidationError("Choose up to 50 projects at a time.");
  }
  const parsed = projectBatchIdsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Choose valid projects and try again.");
  return Array.from(new Set(parsed.data));
}

/** Translates a service error into copy that never leaks database detail. */
export function describeProjectError(error: unknown, validationMessage: string): string {
  const safe = toClientSafeError(error);
  if (safe.code === "VALIDATION_ERROR") return validationMessage;
  if (safe.code === "PERMISSION_DENIED") return "You do not have permission to perform this action.";
  if (safe.code === "NOT_FOUND") return "That project is no longer available.";
  return safe.message;
}

export function failedProjectBatch(
  orderIds: unknown,
  error: string,
): ProjectBulkResult {
  let unique: string[];
  try {
    unique = parseProjectBatchIds(orderIds);
  } catch {
    // Reject the request as one failure; never reflect malformed or unbounded input.
    unique = ["request"];
  }
  return {
    attempted: unique.length,
    succeeded: [],
    failed: unique.map((id) => ({ id, label: unavailableProjectLabel, error })),
  };
}

/**
 * Runs one audited operation per project and records the real outcome of each.
 * Labels are resolved by the caller from server-side data, never from text the
 * browser supplied.
 */
export async function runProjectBatch(
  orderIds: string[],
  resolveLabel: (orderId: string) => string,
  operation: (orderId: string) => Promise<unknown>,
  validationMessage: string,
): Promise<ProjectBulkResult> {
  const unique = Array.from(new Set(orderIds.filter(Boolean)));
  const result: ProjectBulkResult = { attempted: unique.length, succeeded: [], failed: [] };

  for (const orderId of unique) {
    const label = resolveLabel(orderId);
    try {
      await operation(orderId);
      result.succeeded.push({ id: orderId, label });
    } catch (error) {
      result.failed.push({ id: orderId, label, error: describeProjectError(error, validationMessage),
        ...(error instanceof OrderReportRequiredError ? { completionRequirement: error.completionRequirement } : {}),
      });
    }
  }

  return result;
}

/** Honest one-line summary: never reports success while anything failed. */
export function describeProjectBulkResult(result: ProjectBulkResult): string {
  const { attempted, succeeded, failed } = result;
  if (attempted === 0) return "No projects were selected.";
  if (succeeded.length === 0) {
    return failed.length === 1
      ? "No projects were updated. 1 failed."
      : `No projects were updated. ${failed.length} failed.`;
  }
  if (failed.length === 0) {
    return succeeded.length === 1 ? "1 project updated." : `${succeeded.length} projects updated.`;
  }
  return `${succeeded.length} of ${attempted} projects updated. ${failed.length} failed.`;
}
