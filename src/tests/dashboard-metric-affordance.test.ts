import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

/**
 * Dashboard MetricCards are reading surfaces. Without trustworthy period-scoped
 * drill-down routes, chevrons and click choreography would be a false affordance.
 */
describe("dashboard metric card affordance", () => {
  it("keeps MetricCard a non-interactive article without drill-down chrome", () => {
    const page = readSource("src/app/(internal)/dashboard/page.tsx");
    const metricCard = page.slice(
      page.indexOf("function MetricCard"),
      page.indexOf("export default async function DashboardPage"),
    );

    expect(metricCard).toContain("<article");
    expect(metricCard).not.toContain("ChevronRight");
    expect(metricCard).not.toContain("metricArrow");
    expect(metricCard).not.toMatch(/href\s*=/);
    expect(metricCard).not.toMatch(/onClick\s*=/);
    expect(metricCard).not.toContain("<Link");
    expect(metricCard).not.toContain("<a ");
  });

  it("removes metric-card click choreography from dashboard CSS", () => {
    const css = readSource(
      "src/app/(internal)/dashboard/dashboard.module.css",
    );

    expect(css).toContain(".metricCard");
    expect(css).toContain(".metricFeatured");
    expect(css).not.toContain(".metricArrow");
    expect(css).not.toMatch(/\.metricCard:hover/);
    expect(css).not.toMatch(/\.metricFeatured:hover/);
    expect(css).not.toMatch(/\.metricCard:hover\s+\.metricIcon/);
    expect(css).not.toMatch(/\.metricCard:hover\s+\.metricHalo/);
  });
});
