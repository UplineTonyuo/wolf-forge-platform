/**
 * Explicit per-device approval for the local QA LAN (Instruction 03.7).
 *
 * The gate only ever applies when ALL of these hold:
 *   - NODE_ENV is development,
 *   - not on Vercel,
 *   - the requester's peer address (first `x-forwarded-for` value) is NOT
 *     loopback,
 *   - the developer opted in by setting LOCAL_QA_LAN_DEVICES (comma-separated
 *     device IPs).
 *
 * When it applies, the peer address must be listed exactly. An IP address or
 * a shared Wi-Fi network is not authorization: approval is the developer
 * writing the device into the list. Missing, malformed or unlisted IPs are
 * denied (fail closed).
 *
 * The peer address, never the claimed Host, is what exempts a request:
 * `next dev` fills `x-forwarded-for` from the socket when the header is
 * absent, so a genuinely loopback CONNECTION carries a loopback peer even
 * with `--hostname 0.0.0.0` or a hosts-file QA alias, while a LAN device
 * claiming `Host: localhost` still carries its own IP and must earn approval
 * like any other peer — loopback hosts skip tenant_domains verification in
 * the proxy, so a claimed one is not loopback evidence. Browsing the laptop
 * through its own LAN IP is a LAN connection and needs an allowlist entry
 * too.
 *
 * Known ceiling: `x-forwarded-for` is client-suppliable in development (next
 * fills it from the socket only when absent), so a scripted LAN device can
 * forge the loopback peer value AND the same forged value passes
 * `requestHostIsLoopback` in `local-ui-bypass.ts`, which would auto-sign that
 * device into the QA account via `ensureLocalQaSession`. The gate therefore
 * deters unapproved devices; it is not anti-spoof, and the auto-login shares
 * the same ceiling. Acceptable because all of it is development-only, opt-in,
 * and the backend is the local synthetic database. `next dev` does not expose
 * the real socket address through the NextRequest API, so there is no
 * socket-based fix without a pairing mechanism. `ponytail:` add a pairing
 * token if LAN QA ever needs anti-spoof.
 */
export function lanDeviceApproved(
  requestIp: string | null,
  env: { NODE_ENV?: string; VERCEL?: string; LOCAL_QA_LAN_DEVICES?: string },
): boolean {
  if (env.NODE_ENV !== "development" || env.VERCEL === "1") {
    return true;
  }

  const ip = (requestIp ?? "").split(",")[0]?.trim() ?? "";
  if (ip === "127.0.0.1" || ip === "::1") {
    // A loopback CONNECTION. The one source that cannot be "another device",
    // whatever host it reaches the app through. The laptop browsing through
    // its own LAN IP is not loopback and is checked against the allowlist
    // below like any other peer.
    return true;
  }

  const allowed = (env.LOCAL_QA_LAN_DEVICES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (allowed.length === 0) {
    // LAN QA is opt-in. Without an explicit allowlist every non-loopback peer
    // is refused, including one claiming a loopback host.
    return false;
  }

  return allowed.includes(ip);
}
