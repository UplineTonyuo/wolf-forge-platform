/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DepartmentWorkflowLoading } from "../components/operations/department-workflow-loading";

afterEach(cleanup);

describe("Operations workflow loading", () => {
  it("renders the shared layout skeleton without the generic loading copy", () => {
    const { container } = render(<DepartmentWorkflowLoading />);
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(screen.getByRole("status", { name: "Loading department workflow" })).toBeTruthy();
    expect(container.querySelectorAll(".dept-workflow-skeleton-row")).toHaveLength(5);
    expect(container.querySelector(".dept-workflow-skeleton-toolbar span:first-child")).toBeTruthy();
    expect(container.textContent).not.toContain("Loading workflow");
    expect(styles).toMatch(/\.dept-workflow-skeleton\s*\{[\s\S]*?width:\s*100%;/u);
    expect(styles).toMatch(
      /\.dept-workflow-skeleton-toolbar span:first-child\s*\{[\s\S]*?flex:\s*1 1 auto;/u,
    );
  });

  it("is used by all eight live department routes", () => {
    const root = resolve(import.meta.dirname, "../app/(internal)/todo/departments");
    for (const route of [
      "content",
      "gmb-management",
      "off-page-seo",
      "on-page-seo",
      "podcast-seo",
      "technical-seo",
      "website-builder",
      "youtube-seo",
    ]) {
      const source = readFileSync(resolve(root, route, "loading.tsx"), "utf8");
      expect(source).toContain("DepartmentWorkflowLoading");
      expect(source).not.toContain("Loading workflow");
    }
  });
});
