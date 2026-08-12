export type ApplicationErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "CONFLICT"
  | "DATABASE_ERROR";

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly cause?: unknown;

  constructor(code: ApplicationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.cause = options?.cause;
  }
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
