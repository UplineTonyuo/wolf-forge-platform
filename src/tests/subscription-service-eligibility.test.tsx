/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SubscriptionServicePicker, type SubscriptionPickerService } from "../components/subscriptions/subscription-service-picker";
import type { ServiceFolderRow } from "../lib/supabase/database-rows";

const getInternalContext = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: () => getInternalContext() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("../components/subscriptions/subscription-plan-form", () => ({ SubscriptionPlanForm: () => null }));

import NewSubscriptionPage from "../app/(internal)/subscriptions/new/page";
import EditSubscriptionPlanPage from "../app/(internal)/subscriptions/[subscriptionId]/edit/page";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function folder(id: string, name: string, sort_order: number): ServiceFolderRow {
  return { id, name, description: null, image_url: null, parent_id: null, sort_order, archived_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
}

const folders = [
  folder("gbp", "GBP Only SEO", 1),
  folder("local", "Local SEO", 2),
  folder("sprints", "SEO Sprints", 3),
  folder("web", "Website Design", 4),
  folder("ecom", "Ecommerce SEO", 5),
  folder("onpage", "Onpage & Technical SEO", 6),
];

const catalog = [
  { id: "gmb-management", name: "GMB/GBP Management", folder_id: "gbp", subscription_eligible: true },
  { id: "gmb-verification", name: "GMB Verification", folder_id: "gbp", subscription_eligible: false },
  { id: "gmb-optimization", name: "GMB Optimization", folder_id: "gbp", subscription_eligible: false },
  { id: "gbp-reviews", name: "Google Business Profile Reviews ( 10 Reviews)", folder_id: "gbp", subscription_eligible: false },
  { id: "starter-seo", name: "Starter SEO", folder_id: "local", subscription_eligible: true },
  { id: "platinum-seo", name: "Platinum SEO Success Blueprint (100 Targeted Keywords)", folder_id: "local", subscription_eligible: true },
  { id: "franchise", name: "Franchise in a Box System", folder_id: "local", subscription_eligible: false },
  { id: "seo-sprint", name: "SEO SPRINT", folder_id: "sprints", subscription_eligible: false },
  { id: "website-sprint", name: "WEBSITE SPRINT", folder_id: "sprints", subscription_eligible: false },
  { id: "web-build", name: "Standard 20 Page Web Build", folder_id: "web", subscription_eligible: false },
  { id: "ecom-seo", name: "E-Commerce SEO Package", folder_id: "ecom", subscription_eligible: false },
  { id: "onpage-seo", name: "On-page SEO", folder_id: "onpage", subscription_eligible: false },
].map((service, index) => ({ ...service, sort_order: index, is_active: true }));

const hiddenNames = ["GMB Verification", "GMB Optimization", "Google Business Profile Reviews ( 10 Reviews)", "Franchise in a Box System", "SEO SPRINT", "WEBSITE SPRINT", "Standard 20 Page Web Build", "E-Commerce SEO Package", "On-page SEO"];

function context(detail?: unknown) {
  return {
    services: {
      companies: { listActive: async () => [] },
      catalog: { listCatalog: async () => catalog, listFolders: async () => folders },
      subscriptions: { get: async () => detail },
    },
  };
}

/** The page returns <PageFrame><SubscriptionPlanForm .../></PageFrame>; read the form's props. */
function formServices(page: ReactElement): SubscriptionPickerService[] {
  const form = (page.props as { children: ReactElement }).children;
  expect(isValidElement(form)).toBe(true);
  return (form.props as { services: SubscriptionPickerService[] }).services;
}

function openFolder(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: /Choose a service/i }));
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("New Subscription service eligibility", () => {
  it("passes only subscription-eligible Services to the form", async () => {
    getInternalContext.mockResolvedValue(context());
    const names = formServices(await NewSubscriptionPage()).map((service) => service.name);
    expect(names).toEqual(["GMB/GBP Management", "Starter SEO", "Platinum SEO Success Blueprint (100 Targeted Keywords)"]);
    for (const hidden of hiddenNames) expect(names).not.toContain(hidden);
  });

  it("follows the admin toggle: Franchise in a Box appears when on and disappears when off", async () => {
    const franchise = catalog.find((service) => service.id === "franchise")!;
    try {
      franchise.subscription_eligible = true;
      getInternalContext.mockResolvedValue(context());
      expect(formServices(await NewSubscriptionPage()).map((service) => service.id)).toContain("franchise");
    } finally {
      franchise.subscription_eligible = false;
    }
    getInternalContext.mockResolvedValue(context());
    expect(formServices(await NewSubscriptionPage()).map((service) => service.id)).not.toContain("franchise");
  });

  it("shows only folders that hold eligible Services, and search cannot reveal hidden ones", async () => {
    getInternalContext.mockResolvedValue(context());
    const services = formServices(await NewSubscriptionPage());
    render(<SubscriptionServicePicker folders={folders} services={services} value="" onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Choose a service/i }));
    const folderNames = screen.getAllByRole("option").map((option) => option.textContent);
    expect(folderNames.some((text) => text?.includes("GBP Only SEO"))).toBe(true);
    expect(folderNames.some((text) => text?.includes("Local SEO"))).toBe(true);
    for (const hidden of ["SEO Sprints", "Website Design", "Ecommerce SEO", "Onpage & Technical SEO"]) {
      expect(folderNames.some((text) => text?.includes(hidden))).toBe(false);
    }

    fireEvent.click(screen.getByRole("option", { name: /GBP Only SEO/i }));
    expect(screen.getByRole("option", { name: /GMB\/GBP Management/i })).toBeInTheDocument();
    const search = screen.getByRole("textbox", { name: "Search services in selected folder" });
    for (const query of ["Verification", "Optimization", "Reviews", "Website", "Ecommerce", "Sprint"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    }

    fireEvent.click(screen.getByRole("button", { name: /Change folder/i }));
    fireEvent.click(screen.getByRole("option", { name: /Local SEO/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search services in selected folder" }), { target: { value: "Franchise" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("selects eligible GMB and Local SEO Services", async () => {
    getInternalContext.mockResolvedValue(context());
    const services = formServices(await NewSubscriptionPage());
    const onChange = vi.fn();
    render(<SubscriptionServicePicker folders={folders} services={services} value="" onChange={onChange} />);

    openFolder(/GBP Only SEO/i);
    fireEvent.click(screen.getByRole("option", { name: /GMB\/GBP Management/i }));
    expect(onChange).toHaveBeenLastCalledWith("gmb-management");

    fireEvent.click(screen.getByRole("button", { name: /Choose a service|Change service|GMB/i }));
    if (screen.queryByRole("button", { name: /Change folder/i })) fireEvent.click(screen.getByRole("button", { name: /Change folder/i }));
    fireEvent.click(screen.getByRole("option", { name: /Local SEO/i }));
    fireEvent.click(screen.getByRole("option", { name: /Starter SEO/i }));
    expect(onChange).toHaveBeenLastCalledWith("starter-seo");
  });
});

describe("Edit Subscription service eligibility", () => {
  it("offers eligible Services plus the subscription's current Service only", async () => {
    const detail = { subscription: { service_id: "gmb-verification" }, plan_items: [{ service_id: "gmb-verification" }] };
    getInternalContext.mockResolvedValue(context(detail));
    const page = await EditSubscriptionPlanPage({ params: Promise.resolve({ subscriptionId: "sub-1" }) });
    const names = formServices(page).map((service) => service.name);
    expect(names).toEqual(["GMB/GBP Management", "GMB Verification", "Starter SEO", "Platinum SEO Success Blueprint (100 Targeted Keywords)"]);
    expect(names).not.toContain("GMB Optimization");
    expect(names).not.toContain("Franchise in a Box System");
    expect(names).not.toContain("Standard 20 Page Web Build");
  });
});
