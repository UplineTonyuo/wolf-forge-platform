import {
  ApplicationError,
  ConflictError,
  DatabaseError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitedError,
  ValidationError,
} from "./application-error";

export interface DatabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export function mapDatabaseError(error: unknown, resource = "Record"): ApplicationError {
  if (error instanceof ApplicationError) return error;

  const databaseError = error as DatabaseErrorLike;
  switch (databaseError?.code) {
    case "PGRST116":
    case "02000":
    case "P0002":
      return new NotFoundError(resource, error);
    case "42501":
    case "PGRST301":
      return new PermissionDeniedError(error);
    // private.consume_rate_limit raises this custom SQLSTATE. It is not a
    // permission failure and not a validation failure: the same request would
    // have succeeded a moment earlier and will succeed again later.
    case "WF429":
      return new RateLimitedError(error);
    case "23505":
      return new ConflictError("A record with these values already exists.", error);
    case "23503":
      return new ConflictError("The operation conflicts with a related record.", error);
    case "23514":
    case "22023":
    case "22P02":
      return new ValidationError("The data violates a database constraint.", error);
    default:
      return new DatabaseError(error);
  }
}
