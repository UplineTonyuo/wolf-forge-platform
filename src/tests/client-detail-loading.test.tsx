/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactNode, type ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { RouteSkeleton, getInternalSkeletonVariant } from "../components/shell/route-skeletons";
import { RouteTransitionLink } from "../components/shell/route-transition";

const read = vi.hoisted(() => ({ company: vi.fn(), projects: vi.fn(), timeline: vi.fn() }));
vi.mock("../lib/email/client-welcome-email-server", () => ({ canSendClientWelcomeEmail: async () => false }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: async () => ({
  user: { role: "staff", clients: { privateManage: false }, invoices: { manage: false }, forms: { assign: false }, tickets: { create: false } },
  services: { companies: { get: read.company }, orders: { listForCompany: read.projects }, activity: { listTimeline: read.timeline } },
}) }));
const { default: ClientPage } = await import("../app/(internal)/clients/[companyId]/page");
afterEach(cleanup);

function links(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(links);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === RouteTransitionLink ? [node] : []), ...links(node.props.children as ReactNode)];
}

it("selects a neutral Client-detail envelope without list tables, private values or controls", () => {
  expect(getInternalSkeletonVariant("/clients/one?tab=projects")).toBe("clientDetail");
  expect(getInternalSkeletonVariant("/clients/new")).toBe("generic");
  const { container } = render(<RouteSkeleton pathname="/clients/one" />);
  expect(container.querySelector(".client-detail-context")).toBeTruthy();
  expect(container.querySelector(".client-detail-tabs")?.children).toHaveLength(5);
  expect(container.querySelector(".client-detail-content .client-information-panel")).toBeTruthy();
  expect(container.querySelector(".client-side-summary")).toBeTruthy();
  expect(container.querySelector("table, .route-skeleton-table, a, input, button")).toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

it("wires same-record sections and History load-more to inline feedback without changing reads or scroll", async () => {
  read.company.mockResolvedValue({ id: "one", name: "Synthetic client", status: "active", created_at: "2026-10-01" });
  read.projects.mockResolvedValue([]);
  read.timeline.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: String(i), created_at: "2026-10-01T00:00:00Z", entity_type: "company", summary: `Event ${i}` })));
  const result = await ClientPage({ params: Promise.resolve({ companyId: "one" }), searchParams: Promise.resolve({ tab: "history" }) });
  const navigation = links(result);
  const sections = navigation.filter((link) => String(link.props.className).includes("client-detail-tab"));
  expect(sections).toHaveLength(5);
  expect(sections.filter((link) => link.props["aria-current"] === "page").map((link) => link.props.href)).toEqual(["/clients/one?tab=history"]);
  expect(sections.every((link) => link.props.feedback === "inline" && link.props.scroll === false)).toBe(true);
  const more = navigation.find((link) => String(link.props.href).includes("historyLimit"));
  expect(more?.props).toMatchObject({ href: "/clients/one?tab=history&historyLimit=40", feedback: "inline", scroll: false });
  expect(read.company).toHaveBeenCalledWith("one");
  expect(read.timeline).toHaveBeenCalledWith("company", "one");
});
