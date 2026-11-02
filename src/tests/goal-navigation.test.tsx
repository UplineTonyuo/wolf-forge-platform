/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { activeNavigationRoute, navigationForModules } from "../components/shell/nav-registry";
import { RouteSkeleton, getInternalSkeletonVariant } from "../components/shell/route-skeletons";

afterEach(cleanup);

describe("Team Goals navigation", () => {
  it("makes Goals reachable for internal staff without granting member administration", () => {
    const groups = navigationForModules({}, false, true);
    const team = groups.find(group => group.id === "team");
    expect(team?.items.map(item => item.route)).toEqual(["/team/goals"]);
    expect(groups.flatMap(group => group.items).some(item => item.route === "/team")).toBe(false);
    expect(navigationForModules({}).flatMap(group => group.items)).toEqual([]);
  });

  it("keeps existing member and supervision grants separate", () => {
    const team = navigationForModules({ team: true }, false, true).find(group => group.id === "team");
    expect(team?.items.map(item => item.route)).toEqual(["/team", "/team/goals"]);
    expect(activeNavigationRoute("/team/goals/goal-id")).toBe("/team/goals");
    expect(activeNavigationRoute("/team/all-conversations")).toBe("/team/all-conversations");
  });

  it.each([["/team/goals", "goals"], ["/team/goals/goal-id", "goalDetail"]])("gives %s its own body-only skeleton", (path, variant) => {
    expect(getInternalSkeletonVariant(path)).toBe(variant);
    const { container } = render(<RouteSkeleton pathname={path} />);
    expect(container.querySelector("[data-skeleton]")?.getAttribute("data-skeleton")).toBe(variant);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelector("button, a, input, nav, aside, h1")).toBeNull();
  });
});
