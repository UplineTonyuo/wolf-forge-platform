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
    // Pin Next's existing default so a framework upgrade cannot silently make
    // every Server Action accept an unbounded or unexpectedly larger body.
    serverActions: { bodySizeLimit: "1mb" },
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
