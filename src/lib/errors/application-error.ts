export type ApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "REPORT_REQUIRED"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SLOW_MODE_ACTIVE"
  | "DATABASE_ERROR";

export interface ClientSafeError {
  code: ApplicationErrorCode;
  message: string;
  /** Only ever set on SLOW_MODE_ACTIVE — the authoritative wait, never client-guessed. */
  retryAfterSeconds?: number;
}

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly cause?: unknown;

  constructor(code: ApplicationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    Object.defineProperty(this, "cause", {
      value: options?.cause,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  toJSON(): ClientSafeError {
    return { code: this.code, message: this.message };
  }
}

export function toClientSafeError(error: unknown): ClientSafeError {
  if (error instanceof ApplicationError) return error.toJSON();
  return { code: "DATABASE_ERROR", message: "The operation failed." };
}

export class ValidationError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super("VALIDATION_ERROR", message, { cause });
    this.name = "ValidationError";
  }
}

export class OrderReportRequiredError extends ApplicationError {
  constructor(readonly completionRequirement: import("../../domain/reporting/order-completion").OrderReportRequirement, cause?: unknown) {
    super("REPORT_REQUIRED", "A published report is required for this Service and reporting month.", { cause });
  }
}

export class NotFoundError extends ApplicationError {
  constructor(resource: string, cause?: unknown) {
    super("NOT_FOUND", `${resource} was not found.`, { cause });
    this.name = "NotFoundError";
  }
}

export class PermissionDeniedError extends ApplicationError {
  constructor(cause?: unknown) {
    super("PERMISSION_DENIED", "You do not have permission to perform this operation.", {
      cause,
    });
    this.name = "PermissionDeniedError";
  }
}

export class ConflictError extends ApplicationError {
  constructor(message = "The operation conflicts with existing data.", cause?: unknown) {
    super("CONFLICT", message, { cause });
    this.name = "ConflictError";
  }
}

export class DatabaseError extends ApplicationError {
  constructor(cause?: unknown) {
    super("DATABASE_ERROR", "The database operation failed.", { cause });
    this.name = "DatabaseError";
  }
}

/**
 * The caller tripped a server-enforced abuse throttle
 * (`private.consume_rate_limit`, SQLSTATE WF429). The message is deliberately
 * generic: naming the bucket would tell an abuser which control they hit and
 * how to shape the next attempt.
 */
export class RateLimitedError extends ApplicationError {
  constructor(cause?: unknown) {
    super("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", {
      cause,
    });
    this.name = "RateLimitedError";
  }
}

/**
 * A Team conversation's Slow Mode cooldown refused this send/reply/forward
 * (`private.enforce_team_slow_mode`, SQLSTATE WF430 — deliberately its own
 * code, distinct from the anonymous anti-abuse WF429). Unlike rate limiting,
 * Slow Mode is a visible, intentional product feature: the actual remaining
 * wait is authoritative from the database (`DETAIL`, a plain integer) and is
 * safe, useful information to show, not something to hide from an abuser.
 */
export class SlowModeActiveError extends ApplicationError {
  readonly retryAfterSeconds: number | null;

  constructor(retryAfterSeconds: number | null, cause?: unknown) {
    super(
      "SLOW_MODE_ACTIVE",
      retryAfterSeconds
        ? `Slow mode is on. You can send again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`
        : "Slow mode is on for this conversation. Please wait before sending again.",
      { cause },
    );
    this.name = "SlowModeActiveError";
    this.retryAfterSeconds = retryAfterSeconds;
  }

  override toJSON(): ClientSafeError {
    return {
      code: this.code,
      message: this.message,
      ...(this.retryAfterSeconds !== null ? { retryAfterSeconds: this.retryAfterSeconds } : {}),
    };
  }
}
