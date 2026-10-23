export const IDENTITY_UNAVAILABLE_MESSAGE = "Your account information is temporarily unavailable. Please try again.";

type IdentityStage = "session" | "claims" | "membership" | "profile" | "permissions" | "modules" | "client_account";
type LookupResult = { error: unknown; status?: number };

export class IdentityLookupError extends Error {
  constructor(
    readonly kind: "unauthenticated" | "unauthorized" | "unavailable",
    readonly stage: IdentityStage,
  ) {
    super(kind === "unavailable" ? IDENTITY_UNAVAILABLE_MESSAGE : "Account access could not be established.");
    this.name = "IdentityLookupError";
  }
}

/** Profile GET keeps the SDK's bounded retry; other reads retry once, never a lookup 401. */
export async function identityLookup<T extends LookupResult>(
  read: () => PromiseLike<T>,
  stage: IdentityStage,
): Promise<T> {
  const canRetry = stage !== "session" && stage !== "profile";
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: T;
    try {
      result = await read();
    } catch (error) {
      if (attempt === 0 && canRetry && error instanceof TypeError) continue;
      throw new IdentityLookupError("unavailable", stage);
    }
    if (!result.error) return result;

    const error = result.error as { code?: string; status?: number; name?: string };
    const status = result.status ?? error.status;
    const authStage = stage === "claims" || stage === "session";
    if (
      ["PGRST301", "PGRST302", "PGRST303"].includes(error.code ?? "") ||
      (authStage && (
        status === 401 || error.name === "AuthSessionMissingError" ||
        ["invalid_jwt", "bad_jwt", "session_not_found", "session_expired", "refresh_token_not_found",
          "refresh_token_already_used", "user_not_found", "user_banned"].includes(error.code ?? "")
      ))
    ) throw new IdentityLookupError("unauthenticated", stage);

    // This RPC's established 42501 contract means no active client assignment.
    if (stage === "client_account" && error.code === "42501" && status !== 401 && !(status && status >= 500)) return result;
    // The profile query filters its unique primary key, so PGRST116 means no row.
    if (stage === "profile" && error.code === "PGRST116" && status === 406) return result;

    if (attempt === 0 && canRetry && (status === 0 || (status !== undefined && status >= 500 && status <= 599))) continue;
    throw new IdentityLookupError("unavailable", stage);
  }
  throw new IdentityLookupError("unavailable", stage);
}
