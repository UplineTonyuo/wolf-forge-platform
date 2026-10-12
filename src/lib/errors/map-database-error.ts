import {
  ApplicationError,
  ConflictError,
  DatabaseError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitedError,
  SlowModeActiveError,
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
  if (databaseError?.code === "42501" && databaseError.message === "WF_COUPONS_DISABLED") {
    return new ApplicationError("PERMISSION_DENIED", "Coupons are unavailable. This request made no new purchase or payment.", { cause: error });
  }
  if (databaseError?.code === "42501" && databaseError.message === "Historic Coupon terms must be preserved exactly") {
    return new ApplicationError("PERMISSION_DENIED", "Keep the existing Coupon discount, quantity, amount and currency unchanged while Coupons are unavailable.", { cause: error });
  }
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
    // private.enforce_team_slow_mode raises this DISTINCT SQLSTATE (never
    // WF429 — see the comment on SlowModeActiveError for why the two must
    // not collapse into one generic message). DETAIL carries the
    // authoritative remaining-seconds integer as plain text.
    case "WF430": {
      const parsedSeconds = Number(databaseError?.details);
      return new SlowModeActiveError(
        Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : null,
        error,
      );
    }
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
