import "server-only";

export function requestHasExpectedOrigin(request: Request, expectedOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * Same-origin check for routes that have no configured public origin of their
 * own, and so must derive it from the request.
 *
 * It deliberately does NOT use `request.url`. Next normalizes that to
 * `http://localhost:<port>/…` regardless of the host the browser actually
 * asked for, and behind a TLS-terminating proxy the scheme is http while the
 * browser's Origin is https — so comparing against it refuses every genuine
 * same-origin call.
 *
 * The host headers are compared instead. That is sound for CSRF: `Origin` is
 * set by the browser and cannot be forged by page script, and a caller who can
 * set arbitrary headers is not a browser carrying someone else's cookies.
 */
export function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  let originHost: string;
  let originProtocol: string;
  try {
    const parsed = new URL(origin);
    originHost = parsed.host;
    originProtocol = parsed.protocol;
  } catch {
    return false;
  }

  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedProtocol && `${forwardedProtocol}:` !== originProtocol) return false;

  const candidates = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
  ];
  return candidates.some((host) => Boolean(host) && host === originHost);
}
