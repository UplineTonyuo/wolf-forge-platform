import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Next awaits this before sending the error response. Sentry only registers
 * `waitUntil` on Edge, so on Vercel's Node runtime the instance can suspend
 * with the event still queued; flushing here sends it first.
 */
export async function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
) {
  Sentry.captureRequestError(...args);
  await Sentry.flush(2000);
}
