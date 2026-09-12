/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DepartmentsPage from "../app/(internal)/todo/departments/page";

afterEach(cleanup);

describe("Departments directory", () => {
  it("links the eight active and source-ready department workspaces", () => {
    render(<DepartmentsPage />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links[0]).toHaveAccessibleName("Open Podcast SEO department workflow");
    expect(links[0]).toHaveAttribute("href", "/todo/departments/podcast-seo");
    expect(links[1]).toHaveAccessibleName("Open Content department workflow");
    expect(links[1]).toHaveAttribute("href", "/todo/departments/content");
    expect(links[2]).toHaveAccessibleName("Open On-page SEO department workflow");
    expect(links[2]).toHaveAttribute("href", "/todo/departments/on-page-seo");
    expect(links[3]).toHaveAccessibleName("Open GMB Management department workflow");
    expect(links[3]).toHaveAttribute("href", "/todo/departments/gmb-management");
    expect(links[4]).toHaveAccessibleName("Open YouTube SEO department workflow");
    expect(links[4]).toHaveAttribute("href", "/todo/departments/youtube-seo");
    expect(links[5]).toHaveAccessibleName("Open Website Builder department workflow");
    expect(links[5]).toHaveAttribute("href", "/todo/departments/website-builder");
    expect(links[6]).toHaveAccessibleName("Open Technical SEO department workflow");
    expect(links[6]).toHaveAttribute("href", "/todo/departments/technical-seo");
    expect(links[7]).toHaveAccessibleName("Open Off-page SEO department workflow");
    expect(links[7]).toHaveAttribute("href", "/todo/departments/off-page-seo");
    expect(screen.getByText("8 workspaces")).toBeInTheDocument();
  });

  it("gives every live department the same status wording and visual treatment — none is more \"connected\" than another", () => {
    render(<DepartmentsPage />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(8);
    for (const link of links) {
      expect(within(link).getByText("Workspace ready")).toBeInTheDocument();
    }
    // Regression guard: an earlier version singled out Podcast SEO with its own "Connected" status text.
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("does not render the retired Coming Soon directory section", () => {
    render(<DepartmentsPage />);

    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText("WF Media")).not.toBeInTheDocument();
    expect(screen.queryByText(/department in preparation/i)).not.toBeInTheDocument();
  });
});
