export type ApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DATABASE_ERROR";

export interface ClientSafeError {
  code: ApplicationErrorCode;
  message: string;
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
