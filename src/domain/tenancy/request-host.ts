/**
 * Canonical form of a request `Host` header for the `tenant_domains` lookup
 * (WL-2.22b): lowercase, port and one trailing dot removed, DNS label syntax
 * only. Anything else (lists, userinfo, IPv6, whitespace, empty) is null and
 * fails closed. Matching is exact; there are no wildcards.
 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function normalizeRequestHost(raw: string | null): string | null {
  const host = /^([a-z0-9.-]+?)\.?(?::\d{1,5})?$/.exec((raw ?? "").toLowerCase())?.[1];
  return host && host.length <= 253 && HOST_PATTERN.test(host) ? host : null;
}

/**
 * Bounded local development compatibility (WL-2.22b decision 5): these exact
 * loopback hosts select Wolf Forge, and only off Vercel. Every other host,
 * including a LAN address, needs a verified `tenant_domains` row.
 */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);
