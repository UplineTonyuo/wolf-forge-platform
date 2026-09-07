/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DepartmentsPage from "../app/(internal)/todo/departments/page";

afterEach(cleanup);

const UPCOMING_DEPARTMENTS = [
  "On-page SEO",
  "Off-page SEO",
  "GMB Management",
  "Technical SEO",
  "YouTube SEO",
  "Website Builder",
  "WF Media",
];

describe("Departments directory", () => {
  it("links Podcast SEO and the prepared Content workspace", () => {
    render(<DepartmentsPage />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName("Open Podcast SEO department workflow");
    expect(links[0]).toHaveAttribute("href", "/todo/departments/podcast-seo");
    expect(links[1]).toHaveAccessibleName("Open Content department workflow");
    expect(links[1]).toHaveAttribute("href", "/todo/departments/content");
  });

  it("presents every planned department as intentionally non-interactive", () => {
    render(<DepartmentsPage />);

    const plannedRegion = screen.getByRole("region", { name: "Coming soon" });
    const plannedDirectory = within(plannedRegion).getByRole("list", { name: "Coming soon departments" });
    expect(within(plannedDirectory).getAllByRole("listitem")).toHaveLength(7);

    for (const department of UPCOMING_DEPARTMENTS) {
      expect(within(plannedDirectory).getByRole("heading", { name: department })).toBeInTheDocument();
    }

    expect(within(plannedDirectory).queryByRole("link")).not.toBeInTheDocument();
    expect(within(plannedDirectory).queryByRole("button")).not.toBeInTheDocument();
  });
});
