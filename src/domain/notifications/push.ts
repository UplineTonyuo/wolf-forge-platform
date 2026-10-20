import { z } from "zod";

export const STUDIO_PUSH_PROJECT = "rsnmlcyopnxucwgfttyf";
const pushHosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.hash && (pushHosts.has(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)) && url.pathname.length > 1;
  } catch { return false; }
}

export const pushEndpointSchema = z.string().min(1).max(2048).refine(allowedPushEndpoint);

export function studioPushAvailable(source: Record<string, string | undefined>): boolean {
  return source.VERCEL_ENV === "preview"
    && source.SUPABASE_URL === `https://${STUDIO_PUSH_PROJECT}.supabase.co`;
}

export type ClientPushConfiguration = { publicKey: string; origin: string };
