/**
 * Post-login redirect target validation.
 *
 * The login form carries a `next` value straight from the query string, so it
 * is attacker-controlled. A successful sign-in must never be usable to bounce a
 * real staff or client session onto someone else's origin.
 *
 * Validation is done by resolving the candidate against one fixed, trusted
 * base origin and keeping the result only when it still belongs to that origin.
 * The base is an internal sentinel rather than the deployment's public URL on
 * purpose: for a root-relative target the two are equivalent, and a sentinel
 * cannot be moved by a forwarded-host header or a misconfigured environment
 * variable. Nothing is ever redirected to the sentinel itself — only the
 * pathname, search and hash of an accepted target survive.
 */

const TRUSTED_BASE_ORIGIN = "https://app.invalid";

/** Anything rejected falls back to the root of the surface being entered. */
export const DEFAULT_NEXT_PATH = "/";
export const DEFAULT_ACCOUNT_NEXT_PATH = "/account";

/** Longer than any real route; a guard against pathological input. */
const MAX_NEXT_PATH_LENGTH = 2048;

/**
 * C0 controls, DEL and the C1 range. Tab, CR and LF matter most: the URL parser
 * strips them, so `/<TAB>/evil.example` would otherwise change meaning between
 * validation and use. Written as a code-point scan rather than a regex so the
 * exact ranges stay readable.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Normalizes an untrusted `next` value to a same-origin, root-relative target.
 * Returns `fallback` for anything that is not one.
 */
export function safeNextPath(value: unknown, fallback: string = DEFAULT_NEXT_PATH): string {
  if (typeof value !== "string") return fallback;

  const candidate = value;
  if (candidate === "" || candidate.length > MAX_NEXT_PATH_LENGTH) return fallback;
  if (hasControlCharacter(candidate)) return fallback;

  // A backslash is a path separator to the URL parser, so `/\evil.example`
  // resolves exactly like `//evil.example`. It has no legitimate use in one of
  // our routes; percent-encoded `%5C` stays a literal path character and is
  // still allowed through.
  if (candidate.includes("\\")) return fallback;

  // Root-relative only: this rejects `https://evil.example`, `mailto:…`,
  // `javascript:…` and every other absolute or scheme-like form before parsing.
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(candidate, TRUSTED_BASE_ORIGIN);
  } catch {
    return fallback;
  }

  if (resolved.origin !== TRUSTED_BASE_ORIGIN) return fallback;

  const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;

  // `/..//evil.example` normalizes to `//evil.example`, which a browser reads
  // as protocol-relative. The post-normalization check is the one that matters.
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return fallback;

  return normalized;
}

/**
 * True when an already-validated target belongs to the client portal. Compares
 * path segments so `/accountsomething` cannot pass as `/account`.
 */
export function isAccountPath(path: string): boolean {
  const separatorIndex = path.search(/[?#]/);
  const pathname = separatorIndex === -1 ? path : path.slice(0, separatorIndex);
  return pathname === "/account" || pathname.startsWith("/account/");
}

/**
 * The client-portal variant: a validated target is kept only when it stays
 * inside `/account`, and anything else lands on the portal root.
 */
export function safeAccountNextPath(value: unknown): string {
  const path = safeNextPath(value, DEFAULT_ACCOUNT_NEXT_PATH);
  return isAccountPath(path) || /^\/calls\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path) ? path : DEFAULT_ACCOUNT_NEXT_PATH;
}
