/**
 * Redaction for security log metadata. Pure, so it is testable without a
 * server, a request or a sink.
 *
 * ## The rule this file enforces
 *
 * A security log is written precisely when something went wrong, which is
 * exactly the moment a careless `{ ...error }` or `{ ...request.body }` would
 * carry a password, a bearer token or an OAuth code into a log drain that is
 * retained far longer, and read by far more people, than the request itself.
 * A leaked credential in a log is a leaked credential.
 *
 * ## Defence in depth, not a single filter
 *
 *   1. `security-log.ts` accepts a NARROW record shape. There is no field for a
 *      request body, a header map or an error object. That is the primary
 *      control — this file is the second one.
 *   2. Every value that does reach `metadata` passes through `redactMetadata`,
 *      which drops by KEY NAME first (a key called `access_token` never has its
 *      value examined at all) and then scrubs by VALUE SHAPE.
 *   3. Size, depth and breadth are capped, so a hostile or merely large object
 *      cannot turn one event into a megabyte of log.
 *
 * ## What is deliberately NOT here
 *
 * No reversible obfuscation. Nothing in this file can be undone to recover the
 * original value, because a "de-identification" that an attacker with the log
 * can reverse is worse than useless: it looks like a control and is not one.
 * Where a value must be dropped, it is dropped.
 */

export const REDACTED = "[redacted]";
export const REDACTED_EMAIL = "[email]";
export const REDACTED_DIGITS = "[digits]";
export const TRUNCATED_SUFFIX = "…[truncated]";

/** Caps. Generous enough for real diagnostics, small enough to bound the blast. */
export const MAX_STRING_LENGTH = 200;
export const MAX_DEPTH = 3;
export const MAX_OBJECT_KEYS = 20;
export const MAX_ARRAY_ITEMS = 10;

/**
 * Key names whose VALUE is never logged, whatever it looks like. Matched as a
 * substring against the lower-cased key, so `googleClientSecret`,
 * `client_secret` and `SECRET` all hit the same rule.
 *
 * Ordered roughly by how catastrophic the leak would be. Kept deliberately
 * broad: a false positive costs one line of diagnostics, a false negative costs
 * a credential.
 */
export const SENSITIVE_KEY_FRAGMENTS: readonly string[] = Object.freeze([
  "password",
  "passphrase",
  "secret",
  "token",
  "jwt",
  "authorization",
  "auth_header",
  "authheader",
  "cookie",
  "credential",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "signature",
  "bearer",
  "session",
  "verifier",
  "challenge",
  "nonce",
  "otp",
  "salt",
  "service_role",
  "servicerole",
  "anon_key",
  "publishable",
]);

/**
 * Key names that are sensitive only as an EXACT match. `code` is the OAuth
 * authorization code — but `error_code`, `status_code` and `provider_code` are
 * safe and useful, so this cannot be a substring rule.
 */
export const SENSITIVE_EXACT_KEYS: readonly string[] = Object.freeze([
  "code",
  "state",
  "key",
  "pin",
  "hash",
  "body",
  "payload",
  "headers",
  "raw",
]);

/**
 * Value shapes that are secrets wherever they appear, including inside an
 * otherwise innocent string such as a provider error message.
 *
 * Each entry is `[pattern, replacement]`. Patterns are recreated per call —
 * a module-level global regex carries `lastIndex` between calls and would skip
 * matches.
 */
const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  /* JSON Web Token — Supabase session/access tokens, Google id tokens. */
  ["eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]*", REDACTED],
  /* Google OAuth access token. */
  ["ya29\\.[A-Za-z0-9._-]{10,}", REDACTED],
  /* Google OAuth refresh token. */
  ["1//[A-Za-z0-9._-]{10,}", REDACTED],
  /* Google API key. */
  ["AIza[A-Za-z0-9_-]{20,}", REDACTED],
  /*
   * Stripe secret / restricted / publishable / webhook signing keys. The
   * character class includes `_` deliberately: a live key is `sk_live_<id>`,
   * so a class without the underscore stops at `sk_` + four characters and
   * matches nothing.
   */
  ["(?:sk|rk|pk|whsec)_[A-Za-z0-9_]{10,}", REDACTED],
  /* GitHub tokens. */
  ["gh[pousr]_[A-Za-z0-9]{20,}", REDACTED],
  /* AWS access key id. */
  ["AKIA[0-9A-Z]{16}", REDACTED],
  /* Supabase publishable / secret keys. */
  ["sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}", REDACTED],
  /* An Authorization header value that arrived inside a string. */
  ["[Bb]earer\\s+[A-Za-z0-9._~+/-]{8,}={0,2}", REDACTED],
  ["[Bb]asic\\s+[A-Za-z0-9+/]{8,}={0,2}", REDACTED],
  /* Email address. Not a secret, but PII we have no reason to retain. */
  ["[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", REDACTED_EMAIL],
  /*
   * Nine or more consecutive digits: phone numbers and payment instruments.
   * A UUID cannot match (its longest digit run is 8) and neither can a cents
   * amount we would plausibly log.
   */
  ["\\d{9,}", REDACTED_DIGITS],
  /*
   * Catch-all for opaque high-entropy material: 40+ characters of unbroken
   * base64url with no separator. Real prose, paths, UUIDs (36) and event codes
   * all contain a separator or fall under the length, so this is a backstop for
   * token shapes nobody has enumerated yet rather than a routine matcher.
   */
  ["[A-Za-z0-9_-]{40,}", REDACTED],
]);

export function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.includes(lowered)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/** Scrubs secret- and PII-shaped substrings, then caps the length. */
export function redactString(value: string): string {
  let scrubbed = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    scrubbed = scrubbed.replace(new RegExp(pattern, "g"), replacement);
  }

  if (scrubbed.length > MAX_STRING_LENGTH) {
    return scrubbed.slice(0, MAX_STRING_LENGTH) + TRUNCATED_SUFFIX;
  }

  return scrubbed;
}

function redactUnknown(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;

  switch (typeof value) {
    case "string":
      return redactString(value);
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      return `${value}`;
    /*
     * A function or a symbol in metadata is a mistake at the call site. Naming
     * the type is enough to find it; serializing it is not useful and could
     * carry a closed-over value through `toString()`.
     */
    case "function":
    case "symbol":
      return REDACTED;
    default:
      break;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  }

  /*
   * An Error reaching metadata is exactly the accident this module exists for:
   * `message` routinely carries the offending value, and `cause` can carry a
   * whole provider response. Collapse it to its name and let the caller decide,
   * explicitly, which fields are safe.
   */
  if (value instanceof Error) return value.name;

  if (depth >= MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactUnknown(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(TRUNCATED_SUFFIX);
    return items;
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let kept = 0;

    for (const key of Object.keys(source)) {
      if (kept >= MAX_OBJECT_KEYS) {
        result["…"] = TRUNCATED_SUFFIX;
        break;
      }
      kept += 1;
      result[key] = isSensitiveKey(key) ? REDACTED : redactUnknown(source[key], depth + 1);
    }

    return result;
  }

  return REDACTED;
}

/**
 * The only entry point. Returns a plain, JSON-safe object with every sensitive
 * key dropped, every secret-shaped value scrubbed and every size capped.
 *
 * Returns `null` rather than throwing on anything it cannot process: a logger
 * that can fail is a logger that takes the request down with it.
 */
export function redactMetadata(metadata: unknown): Record<string, unknown> | null {
  if (metadata === null || metadata === undefined) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return null;

  try {
    const redacted = redactUnknown(metadata, 0);
    if (redacted === null || typeof redacted !== "object" || Array.isArray(redacted)) return null;
    return Object.keys(redacted).length > 0 ? (redacted as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
