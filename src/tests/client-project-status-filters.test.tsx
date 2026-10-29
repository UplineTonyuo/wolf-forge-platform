// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProjectsList } from "../components/account/projects/client-projects-list";
import type { ClientProjectView } from "../domain/orders/client-projections";
import { orderStatuses } from "../domain/orders/schema";

const projects: ClientProjectView[] = orderStatuses.map((status, index) => ({
  id: `project-${index}`, title: `Project ${status}`, status, statusLabel: status,
  reference: `WF-P${index}`, serviceName: "Synthetic service", createdLabel: "Oct 29, 2026",
  startedLabel: null, dueLabel: null, completedLabel: null,
  progress: { total: 0, completed: 0, percent: null },
}));
afterEach(cleanup);
describe("client project status filters", () => {
  it("offers each real status and keeps canceled projects out of Completed", () => {
    render(<ClientProjectsList projects={projects} />);
    const completed = screen.getByRole("region", { name: "Completed" });
    expect(within(completed).getByRole("link", { name: /Project complete/ })).toBeTruthy();
    expect(within(completed).queryByRole("link", { name: /Project canceled/ })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Canceled" })).getByRole("link")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "All projects, 7 projects" }).getAttribute("aria-pressed")).toBe("true");
  });
  it.each([
    ["Pending", "pending"], ["Getting started", "submitted"], ["Wolf Forge working", "working"],
    ["Waiting for reply", "waiting_reply"], ["Needs information", "pending_update"],
    ["Completed", "complete"], ["Canceled", "canceled"],
  ])("filters %s immediately without changing project statuses", (label, status) => {
    const before = structuredClone(projects);
    render(<ClientProjectsList projects={projects} />);
    const button = screen.getByRole("button", { name: `${label}, 1 project` });
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain(`Project ${status}`);
    expect(links[0].getAttribute("href")).toBe(`/account/projects/project-${orderStatuses.indexOf(status as typeof orderStatuses[number])}`);
    expect(projects).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "All projects, 7 projects" }));
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });
  it("announces an empty filtered result and reflects refreshed counts", () => {
    const { rerender } = render(<ClientProjectsList projects={[projects[0]!]} />);
    fireEvent.click(screen.getByRole("button", { name: "Completed, 0 projects" }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("0 projects · Completed");
    rerender(<ClientProjectsList projects={projects} />);
    expect(screen.getByRole("button", { name: "Completed, 1 project" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
