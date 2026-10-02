import { describe, expect, it } from "vitest";
import {
  composeClientProjectViews,
  countOpenClientProjects,
  projectReference,
  type ClientProjectSourceRow,
} from "../domain/orders/client-projections";
import {
  composeStoreCatalog,
  isClientVisibleService,
  selectStoreFolder,
  toStoreFolderLinks,
  toStoreServiceView,
} from "../domain/services/store-projections";
import type { ServiceFolderRow, ServiceRow } from "../lib/supabase/database-rows";

const timestamp = "2026-08-01T00:00:00.000Z";

function folder(overrides: Partial<ServiceFolderRow> & { id: string; name: string }): ServiceFolderRow {
  return {
    archived_at: null,
    created_at: timestamp,
    description: null,
    image_url: null,
    parent_id: null,
    sort_order: 0,
    updated_at: timestamp,
    ...overrides,
  };
}

function service(overrides: Partial<ServiceRow> & { id: string; name: string }): ServiceRow {
  return {
    archived_at: null,
    assigned_to_profile_id: null,
    created_at: timestamp,
    currency: "USD",
    deadline_amount: null,
    deadline_unit: null,
    description: null,
    folder_id: null,
    group_quantities: false,
    image_url: null,
    is_active: true,
    is_public: true,
    price: 297,
    recurring: false,
    recurring_action: null,
    recurring_interval_length: null,
    recurring_interval_unit: null,
    recurring_price: null,
    require_client_profile: false,
    subscription_eligible: false,
    sort_order: 0,
    updated_at: timestamp,
    ...overrides,
  };
}

describe("client-visible service predicate", () => {
  it("restates the services RLS rule so an internal row cannot slip into a client view", () => {
    expect(isClientVisibleService(service({ id: "a", name: "Public" }))).toBe(true);
    expect(isClientVisibleService(service({ id: "b", name: "Private", is_public: false }))).toBe(false);
    expect(isClientVisibleService(service({ id: "c", name: "Inactive", is_active: false }))).toBe(false);
    expect(isClientVisibleService(service({ id: "d", name: "Archived", archived_at: timestamp }))).toBe(false);
  });
});

describe("store catalog composition", () => {
  const folders = [
    folder({ id: "local", name: "Local SEO", description: "Rank where you trade." }),
    folder({ id: "gbp", name: "GBP Only SEO" }),
    folder({ id: "empty", name: "Unlaunched Category" }),
    folder({ id: "gone", name: "Retired Category", archived_at: timestamp }),
  ];

  const services = [
    service({ id: "s1", name: "Starter SEO", folder_id: "local" }),
    service({ id: "s2", name: "Growth SEO", folder_id: "local" }),
    service({ id: "s3", name: "GMB Optimization", folder_id: "gbp" }),
    service({ id: "s4", name: "Private Retainer", folder_id: "local", is_public: false }),
    service({ id: "s5", name: "Inactive Bundle", folder_id: "gbp", is_active: false }),
    service({ id: "s6", name: "Archived Extra", folder_id: "gbp", archived_at: timestamp }),
    service({ id: "s7", name: "Retired Folder Service", folder_id: "gone" }),
    service({ id: "s8", name: "Loose Service", folder_id: null }),
  ];

  it("drops non-public, inactive and archived services even when handed them", () => {
    const catalog = composeStoreCatalog(folders, services);
    const names = [
      ...catalog.folders.flatMap((entry) => entry.services.map((view) => view.name)),
      ...catalog.ungrouped.map((view) => view.name),
    ];

    expect(names).not.toContain("Private Retainer");
    expect(names).not.toContain("Inactive Bundle");
    expect(names).not.toContain("Archived Extra");
    expect(catalog.serviceCount).toBe(5);
  });

  it("drops a folder with no client-visible service, so an unlaunched category never appears", () => {
    const catalog = composeStoreCatalog(folders, services);

    expect(catalog.folders.map((entry) => entry.name)).toEqual(["Local SEO", "GBP Only SEO"]);
    expect(catalog.folders.map((entry) => entry.services.length)).toEqual([2, 1]);
  });

  it("buckets services whose folder is missing or archived instead of hiding them", () => {
    const catalog = composeStoreCatalog(folders, services);

    expect(catalog.ungrouped.map((view) => view.name).sort()).toEqual([
      "Loose Service",
      "Retired Folder Service",
    ]);
  });

  it("exposes only real folders as sidebar links, with their live counts", () => {
    expect(toStoreFolderLinks(composeStoreCatalog(folders, services))).toEqual([
      { id: "local", name: "Local SEO", serviceCount: 2 },
      { id: "gbp", name: "GBP Only SEO", serviceCount: 1 },
    ]);
  });

  it("falls back to the whole Store for an unknown folder id rather than erroring", () => {
    const catalog = composeStoreCatalog(folders, services);

    expect(selectStoreFolder(catalog, "local")?.name).toBe("Local SEO");
    expect(selectStoreFolder(catalog, "empty")).toBeNull();
    expect(selectStoreFolder(catalog, "does-not-exist")).toBeNull();
    expect(selectStoreFolder(catalog, undefined)).toBeNull();
  });
});

describe("store service view", () => {
  it("sanitizes captured catalog HTML and keeps the full original for the detail page", () => {
    const view = toStoreServiceView(
      service({
        id: "s1",
        name: "GMB Optimization",
        description:
          "<h2>MAPS SYSTEM</h2><div>Your Google Business Profile might be costing you customers every week.</div><div>✅ Category optimization</div><script>alert(1)</script>",
      }),
    );

    // The detail page still receives the whole sanitized description.
    expect(view.descriptionHtml).toContain("Category optimization");
    expect(view.descriptionHtml).toContain("MAPS SYSTEM");
    expect(view.descriptionHtml).not.toContain("script");

    // The card preview does not: it gets the curated one-line summary, never
    // the prose lead, the heading or the inclusion list.
    expect(view.summary).toBe(
      "Fixes the foundation of your Google Business Profile (categories, services, local keywords, and photos) so you outrank competitors.",
    );
    expect(view.summary).not.toContain("MAPS SYSTEM");
    expect(view.summary).not.toContain("Category optimization");
    expect(view.summary).not.toContain("costing you customers");
  });

  it("labels one-time and recurring pricing from the real catalog columns", () => {
    expect(toStoreServiceView(service({ id: "a", name: "One time", price: 297 })).priceLabel).toBe("$297");
    expect(toStoreServiceView(service({ id: "b", name: "Cents", price: 297.5 })).priceLabel).toBe("$297.50");

    expect(
      toStoreServiceView(
        service({
          id: "c",
          name: "Monthly",
          recurring: true,
          recurring_price: 197,
          recurring_interval_length: 1,
          recurring_interval_unit: "month",
        }),
      ).recurringLabel,
    ).toBe("$197 / month");

    expect(
      toStoreServiceView(
        service({
          id: "d",
          name: "Quarterly",
          recurring: true,
          recurring_price: 500,
          recurring_interval_length: 3,
          recurring_interval_unit: "month",
        }),
      ).recurringLabel,
    ).toBe("$500 every 3 months");

    expect(toStoreServiceView(service({ id: "e", name: "One time" })).recurringLabel).toBeNull();
  });

  /*
   * The catalogue stores the single-letter codes its CHECK constraint allows
   * ('D', 'W', 'M', 'Y'), not the long names the fixtures above use. Only the
   * long names used to resolve, so the one real recurring service in the live
   * catalogue priced as "$97 recurring" and its money was grouped as "Other
   * recurring" rather than monthly.
   */
  it("resolves the single-letter interval codes the real catalogue stores", () => {
    const monthly = toStoreServiceView(
      service({
        id: "m",
        name: "GMB/GBP Management",
        price: 0,
        recurring: true,
        recurring_price: 97,
        recurring_interval_length: 1,
        recurring_interval_unit: "M",
      }),
    );

    expect(monthly.recurringLabel).toBe("$97 / month");
    expect(monthly.cadence).toBe("monthly");

    const annual = toStoreServiceView(
      service({
        id: "y",
        name: "Annual",
        recurring: true,
        recurring_price: 1200,
        recurring_interval_length: 1,
        recurring_interval_unit: "Y",
      }),
    );

    expect(annual.recurringLabel).toBe("$1,200 / year");
    expect(annual.cadence).toBe("annual");

    const quarterly = toStoreServiceView(
      service({
        id: "q",
        name: "Quarterly",
        recurring: true,
        recurring_price: 500,
        recurring_interval_length: 3,
        recurring_interval_unit: "M",
      }),
    );

    expect(quarterly.recurringLabel).toBe("$500 every 3 months");
    // Still "other": a quarterly rhythm is neither monthly nor annual money.
    expect(quarterly.cadence).toBe("other");
  });

  it("carries no internal catalog field into the client view model", () => {
    const view = toStoreServiceView(
      service({
        id: "s1",
        name: "Starter SEO",
        assigned_to_profile_id: "00000000-0000-4000-8000-000000000001",
        deadline_amount: 14,
        deadline_unit: "day",
        require_client_profile: true,
      }),
    );

    for (const leaked of ["assigned_to_profile_id", "deadline_amount", "deadline_unit", "require_client_profile"]) {
      expect(Object.keys(view)).not.toContain(leaked);
    }
  });
});

describe("client project projection", () => {
  const rows: ClientProjectSourceRow[] = [
    {
      id: "p1",
      order_number: 42,
      title: "Local SEO launch",
      status: "working",
      created_at: "2026-07-01T00:00:00.000Z",
      due_at: "2026-09-01T00:00:00.000Z",
      started_at: "2026-07-03T00:00:00.000Z",
      completed_at: null,
      service_name: "Starter SEO",
      task_total: 4,
      task_open: 2,
    },
    {
      id: "p2",
      order_number: 7,
      title: "Press release",
      status: "complete",
      created_at: "2026-05-01T00:00:00.000Z",
      due_at: null,
      started_at: null,
      completed_at: "2026-06-01T00:00:00.000Z",
      service_name: null,
      task_total: 0,
      task_open: 0,
    },
  ];

  it("exposes only client-safe project fields", () => {
    const [view] = composeClientProjectViews(rows);

    expect(Object.keys(view!).sort()).toEqual([
      "completedLabel",
      "createdLabel",
      "dueLabel",
      "id",
      "progress",
      "reference",
      "serviceName",
      "startedLabel",
      "status",
      "statusLabel",
      "title",
    ]);
  });

  it("never carries notes, assignee identity or a task title", () => {
    const serialized = JSON.stringify(composeClientProjectViews(rows));

    for (const leaked of ["notes", "assigned_to_profile_id", "assignee", "profiles", "company_id"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("reduces tasks to an aggregate progress figure only", () => {
    const [view] = composeClientProjectViews(rows);

    expect(view!.progress).toEqual({ total: 4, completed: 2, percent: 50 });
  });

  it("reports no progress rather than a false zero when a project has no tasks", () => {
    const [, view] = composeClientProjectViews(rows);

    expect(view!.progress).toEqual({ total: 0, completed: 0, percent: null });
  });

  it("labels status and reference from the shared project domain", () => {
    const [working, complete] = composeClientProjectViews(rows);

    expect(working!.statusLabel).toBe("Working");
    expect(working!.reference).toBe("WF-P0042");
    expect(complete!.statusLabel).toBe("Complete");
    expect(projectReference(7)).toBe("WF-P0007");
  });

  it("counts only projects still in flight as open", () => {
    expect(countOpenClientProjects(composeClientProjectViews(rows))).toBe(1);
  });
});
