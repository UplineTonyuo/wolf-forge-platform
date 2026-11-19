/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactNode, type ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ClientSectionSkeleton, RouteSkeleton, getInternalSkeletonVariant } from "../components/shell/route-skeletons";
import { RouteTransitionLink } from "../components/shell/route-transition";
import { ClientDetailSections } from "../components/clients/client-detail-sections";

const read = vi.hoisted(() => ({ company: vi.fn(), projects: vi.fn(), timeline: vi.fn() }));
vi.mock("../lib/email/client-welcome-email-server", () => ({ canSendClientEmail: async () => false }));
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

it("uses compact invoice rows for invoice-tab loading without financial values or interactive links", () => {
  const { container } = render(<ClientSectionSkeleton section="invoices" />);
  expect(screen.getByRole('status', { name: 'Loading client invoices' })).toBeTruthy();
  expect(container.querySelectorAll('[data-client-section="invoices"] ul > li')).toHaveLength(3);
  expect(container.querySelector('a, button')).toBeNull();
  expect(container.querySelector('[data-client-section="invoices"]')?.textContent?.trim()).toBe('');
});

it("delegates section-body feedback while retaining History load-more and existing data reads", async () => {
  read.company.mockResolvedValue({ id: "one", name: "Synthetic client", status: "active", created_at: "2026-10-01" });
  read.projects.mockResolvedValue([]);
  read.timeline.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: String(i), created_at: "2026-10-01T00:00:00Z", entity_type: "company", summary: `Event ${i}` })));
  const result = await ClientPage({ params: Promise.resolve({ companyId: "one" }), searchParams: Promise.resolve({ tab: "history" }) });
  const navigation = links(result);
  function findSections(node: ReactNode): ReactElement<Record<string, unknown>> | undefined {
    if (Array.isArray(node)) return node.map(findSections).find(Boolean);
    if (!isValidElement<Record<string, unknown>>(node)) return;
    return node.type === ClientDetailSections ? node : findSections(node.props.children as ReactNode);
  }
  expect(findSections(result)?.props).toMatchObject({ companyId: "one", activeTab: "history" });
  const more = navigation.find((link) => String(link.props.href).includes("historyLimit"));
  expect(more?.props).toMatchObject({ href: "/clients/one?tab=history&historyLimit=40", feedback: "inline", scroll: false });
  expect(read.company).toHaveBeenCalledWith("one");
  expect(read.timeline).toHaveBeenCalledWith("company", "one");
});
