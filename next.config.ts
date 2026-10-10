import { withSentryConfig } from "@sentry/nextjs/config";
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
    ? { allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.95", "qa.wolf-forge.local", "qa-b.wolf-forge.local", "qa-intent.wolf-forge.local", "qa-projects.wolf-forge.local"] }
    : {}),

  /**
   * Browser production source maps are generated for Sentry only and are
   * never served (D-110, amended 2026-09-24).
   *
   * Served maps would hand anyone the original module names, comments and
   * control flow of the entire client tree. They exist only so Sentry can
   * symbolicate browser errors: `deleteSourcemapsAfterUpload` below removes
   * every `.next/static/**` map inside `next build` — whether or not the
   * upload succeeded — and strips the `sourceMappingURL` comments, so nothing
   * reaches the deployment. Pinned explicitly so the posture stays a
   * deliberate, auditable edit under D-101.
   */
  productionBrowserSourceMaps: true,

  env: {
    NEXT_PUBLIC_SENTRY_ENABLED:
      process.env.VERCEL === "1" || process.env.SENTRY_ENABLE_DEV === "1"
        ? "1"
        : "0",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT:
      process.env.VERCEL_ENV ?? "development",
  },

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

export default withSentryConfig(withBotId(nextConfig), {
  org: "wolf-forge",
  project: "javascript-nextjs",
  silent: !process.env.CI,
  // Load-bearing for D-110: browser maps must never ship with the deployment.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
