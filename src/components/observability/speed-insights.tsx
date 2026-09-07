"use client";

import { SpeedInsights as VercelSpeedInsights } from "@vercel/speed-insights/next";
import { sanitizeSpeedInsightsEvent } from "../../domain/observability/speed-insights-privacy";

/**
 * The one Speed Insights mount for the whole app. Kept as its own client
 * component so the root layout can stay a Server Component; every event is
 * routed through {@link sanitizeSpeedInsightsEvent} before it ever leaves
 * the browser.
 */
export function SpeedInsights() {
  return <VercelSpeedInsights beforeSend={sanitizeSpeedInsightsEvent} />;
}
