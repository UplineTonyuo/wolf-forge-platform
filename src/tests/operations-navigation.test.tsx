/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/todo";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

const { OperationsTabs } = await import("../components/operations/operations-tabs");
const { TasksLoading } = await import("../components/operations/tasks-loading");
const { DepartmentsDirectoryLoading } = await import(
  "../components/operations/departments-directory-loading"
);

afterEach(cleanup);

describe("Operations tab active state follows the URL, never local state", () => {
  it("marks Tasks active only at exactly /todo", () => {
    pathname = "/todo";
    render(<OperationsTabs />);

    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Departments" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks Departments active on the directory and on every drill-down route", () => {
    pathname = "/todo/departments";
    const view = render(<OperationsTabs />);
    expect(
      screen.getByRole("link", { name: "Departments" }).getAttribute("aria-current"),
    ).toBe("page");
    view.unmount();

    pathname = "/todo/departments/podcast-seo";
    render(<OperationsTabs />);
    expect(
      screen.getByRole("link", { name: "Departments" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBeNull();
  });

  it("routes to the canonical URLs, not synthetic ids", () => {
    pathname = "/todo";
    render(<OperationsTabs />);
    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("href")).toBe("/todo");
    expect(screen.getByRole("link", { name: "Departments" }).getAttribute("href")).toBe(
      "/todo/departments",
    );
  });
});

describe("Operations route-transition skeletons", () => {
  it("Tasks skeleton reuses the real page's section chrome and geometry, with no generic loading copy", () => {
    const { container } = render(<TasksLoading />);
    const region = screen.getByRole("status", { name: "Loading tasks" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.className).toContain("attention-stack");
    // Same dividers and section headings as the page, but drawn as bars: no text.
    expect(region.textContent?.trim()).toBe("");
    expect(container.querySelectorAll(".attention-title")).toHaveLength(2);
    expect(container.querySelectorAll(".section-heading .tasks-skeleton-bar-heading")).toHaveLength(4);
    expect(container.querySelectorAll(".attention-rows").length).toBeGreaterThan(0);
    expect(screen.queryByText(/loading workflow/iu)).toBeNull();
  });

  it("Departments directory skeleton reuses the real directory's own CSS module classes", () => {
    const { container } = render(<DepartmentsDirectoryLoading />);
    const region = screen.getByRole("status", { name: "Loading department directory" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Department directory")).toBeTruthy();
    expect(screen.getByText("8 workspaces")).toBeTruthy();
    expect(container.querySelectorAll('[class*="departmentCard"]').length).toBe(8);
    expect(screen.queryByText(/loading workflow/iu)).toBeNull();
  });
});
