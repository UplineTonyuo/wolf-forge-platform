import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import {
  readSecurityHeaderEnvironment,
  securityHeaderRules,
} from "./src/lib/security/response-headers";

const nextConfig: NextConfig = {
  // No X-Powered-By: it names the framework and version to every caller.
  poweredByHeader: false,
  devIndicators: false,

  /**
   * Next blocks cross-origin requests to dev-only assets/endpoints (JS
   * chunks, HMR websocket, Server Actions) by default — only the server's own
   * detected hostname is allowed. `--hostname 0.0.0.0` makes the dev server
   * reachable over LAN, but without this the browser never gets a working
   * client bundle from that origin: it hydrates never, so contenteditable
   * still takes typing (a native browser feature) while every click handler
   * (send, reply, toolbar, attach) is dead. Dev-only mechanism per Next's own
   * docs — inert in a production build regardless, but scoped explicitly so
   * that stays true on a framework upgrade too.
   */
  ...(process.env.NODE_ENV !== "production"
    ? { allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.95"] }
    : {}),

  /**
   * Browser production source maps stay OFF (D-110).
   *
   * This is already Next's default — the point of pinning it is auditability.
   * With maps served, the production bundle hands anyone the original module
   * names, comments and control flow of the entire client tree. Written
   * explicitly so the posture is visible in the one config file D-101 makes
   * authoritative, and so turning it on has to be a deliberate edit rather
   * than a default that drifted.
   *
   * Server-side maps still exist inside `.next/server` and are never served.
   */
  productionBrowserSourceMaps: false,

  experimental: {
    authInterrupts: true,
    // Ticket attachments allow up to TICKET_ATTACHMENT_MAX_BYTES (5 MiB); this
    // must exceed that to leave room for multipart/FormData overhead, or valid
    // attachments get rejected by Next before the app's own 5 MiB check runs.
    serverActions: { bodySizeLimit: "6mb" },
  },

  /**
   * The single authority for security response headers (D-101). There is no
   * vercel.json and no per-route header block anywhere in this repository —
   * `src/lib/security/response-headers.ts` builds the whole set and it is
   * applied here, once, to every path.
   */
  headers: async () => securityHeaderRules(readSecurityHeaderEnvironment()),
};

export default withBotId(nextConfig);
