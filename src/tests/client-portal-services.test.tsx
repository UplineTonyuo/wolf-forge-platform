/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ServiceChooserProvider } from "../components/account/services/service-chooser-context";
import { ClientQuickAction } from "../components/account/command/client-quick-action";
import { ClientServicesPanel } from "../components/account/command/client-services-panel";
import { HeaderPanelsProvider } from "../components/account/command/header-panels";
import {
  filterChooserServices,
  toServiceChooserCatalog,
  type ChooserService,
  type ServiceChooserCatalog,
} from "../domain/client-portal/service-chooser";
import type { StoreCatalog } from "../domain/services/store-projections";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/account",
}));

afterEach(cleanup);

/** Reports the pointer capability the header manager keys hover behaviour on. */
function stubHover(hasHover: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("hover: hover") ? hasHover : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function service(name: string, id = name.toLowerCase().replaceAll(" ", "-")) {
  return {
    id,
    name,
    folderId: "f",
    priceLabel: "$500",
    amount: 500,
    currency: "USD",
    recurring: false,
    cadence: "one-time" as const,
    recurringLabel: null,
    imageUrl: null,
    descriptionHtml: "",
    summary: `${name} summary`,
  };
}

const storeCatalog: StoreCatalog = {
  folders: [
    {
      id: "folder-local",
      name: "Local SEO",
      description: "Rank in your city",
      services: [service("Local SEO Starter"), service("Local SEO Growth")],
    },
    {
      id: "folder-backlinks",
      name: "Backlink Service",
      description: null,
      services: [service("Backlink Foundations")],
    },
    {
      id: "folder-press",
      name: "Press Releases",
      description: null,
      services: [service("Press Release Distribution")],
    },
  ],
  ungrouped: [service("Standalone Audit", "standalone")],
  serviceCount: 5,
};

const chooserCatalog = toServiceChooserCatalog(storeCatalog);

function renderChooser(
  catalog: ServiceChooserCatalog = chooserCatalog,
  available = true,
) {
  function Harness() {
    return (
      <ServiceChooserProvider catalog={catalog} available={available}>
        <HeaderPanelsProvider>
          <ClientServicesPanel />
          <ClientQuickAction canMessage onNavigateToMessages={() => {}} />
        </HeaderPanelsProvider>
      </ServiceChooserProvider>
    );
  }

  return render(<Harness />);
}

/** Opens the catalogue explorer through its own trigger. */
async function openChooser() {
  fireEvent.click(screen.getByRole("button", { name: "Explore services" }));
  return screen.findByRole("dialog", { name: "Explore Wolf Forge Services" });
}

describe("service chooser projection", () => {
  it("derives folders and services from the real store catalog", () => {
    expect(chooserCatalog.folders.map((folder) => folder.name)).toEqual([
      "Local SEO",
      "Backlink Service",
      "Press Releases",
    ]);
    expect(chooserCatalog.folders[0]?.serviceCount).toBe(2);
    expect(chooserCatalog.services).toHaveLength(5);
  });

  it("keeps ungrouped services searchable with no category", () => {
    const standalone = chooserCatalog.services.find((entry) => entry.id === "standalone");

    expect(standalone?.folderId).toBeNull();
    expect(standalone?.folderName).toBeNull();
  });

  it("links every service to its existing detail route", () => {
    expect(chooserCatalog.services.every((entry) => entry.href.startsWith("/account/store/"))).toBe(
      true,
    );
  });
});

describe("predictive service search", () => {
  const services: ChooserService[] = chooserCatalog.services;

  it("matches anywhere in the name, case-insensitively", () => {
    expect(filterChooserServices(services, "seo").map((entry) => entry.name)).toEqual([
      "Local SEO Growth",
      "Local SEO Starter",
    ]);
    expect(filterChooserServices(services, "SEO")).toHaveLength(2);
  });

  it("finds backlink services from a partial word", () => {
    expect(filterChooserServices(services, "back").map((entry) => entry.name)).toEqual([
      "Backlink Foundations",
    ]);
  });

  it("finds press release services from a partial word", () => {
    expect(filterChooserServices(services, "press").map((entry) => entry.name)).toEqual([
      "Press Release Distribution",
    ]);
  });

  it("matches a category name so typing a folder finds what is inside it", () => {
    // "Local SEO Starter" also matches by name; the category-only hit still
    // surfaces rather than being dropped.
    expect(filterChooserServices(services, "Local SEO")).toHaveLength(2);
  });

  it("returns nothing for a blank query rather than the whole catalog", () => {
    expect(filterChooserServices(services, "")).toEqual([]);
    expect(filterChooserServices(services, "   ")).toEqual([]);
  });

  it("ranks a name hit above a category-only hit", () => {
    const results = filterChooserServices(services, "backlink");
    expect(results[0]?.name).toBe("Backlink Foundations");
  });
});

describe("service chooser interaction", () => {
  it("shows categories first rather than dumping every service", async () => {
    renderChooser();
    const dialog = await openChooser();

    expect(within(dialog).getByText("Categories")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Local SEO/ })).toBeInTheDocument();

    // No service row is visible until a category or a search narrows things.
    expect(within(dialog).queryByText("Local SEO Starter")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Press Release Distribution")).not.toBeInTheDocument();
  });

  it("reveals a category's real services when it is chosen", async () => {
    renderChooser();
    const dialog = await openChooser();

    fireEvent.click(within(dialog).getByRole("button", { name: /Local SEO/ }));

    expect(within(dialog).getByText("Local SEO Starter")).toBeInTheDocument();
    expect(within(dialog).getByText("Local SEO Growth")).toBeInTheDocument();
    expect(within(dialog).queryByText("Backlink Foundations")).not.toBeInTheDocument();
  });

  it("filters across the whole catalog while typing", async () => {
    renderChooser();
    const dialog = await openChooser();

    fireEvent.change(within(dialog).getByLabelText("Search services"), {
      target: { value: "press" },
    });

    expect(within(dialog).getByText("Press Release Distribution")).toBeInTheDocument();
    expect(within(dialog).queryByText("Local SEO Starter")).not.toBeInTheDocument();
    expect(within(dialog).getByText("1 service found")).toBeInTheDocument();
  });

  it("says so honestly when nothing matches", async () => {
    renderChooser();
    const dialog = await openChooser();

    fireEvent.change(within(dialog).getByLabelText("Search services"), {
      target: { value: "zzzz" },
    });

    expect(within(dialog).getByText(/No services match/)).toBeInTheDocument();
  });

  it("hands a chosen service to the existing detail route", async () => {
    renderChooser();
    const dialog = await openChooser();

    fireEvent.click(within(dialog).getByRole("button", { name: /Backlink Service/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Backlink Foundations/ }));

    expect(push).toHaveBeenCalledWith("/account/store/backlink-foundations");
  });

  it("closes on Escape", async () => {
    renderChooser();
    await openChooser();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders no explorer trigger at all when the account has no Store module", () => {
    renderChooser({ folders: [], services: [] }, false);

    expect(screen.queryByRole("button", { name: "Explore services" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("client quick actions", () => {
  it("offers only client-appropriate actions", async () => {
    renderChooser();
    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Invest in a service"),
      expect.stringContaining("Message Wolf Forge"),
    ]);

    for (const forbidden of [/add client/i, /add company/i, /add employee/i, /admin/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it("hides the messaging action when the module is denied", async () => {
    render(
      <ServiceChooserProvider catalog={chooserCatalog} available>
        <HeaderPanelsProvider>
          <ClientQuickAction canMessage={false} onNavigateToMessages={() => {}} />
        </HeaderPanelsProvider>
      </ServiceChooserProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Invest in a service");
  });

  it("renders no trigger at all when neither action is available", () => {
    render(
      <ServiceChooserProvider catalog={{ folders: [], services: [] }} available={false}>
        <HeaderPanelsProvider>
          <ClientQuickAction canMessage={false} onNavigateToMessages={() => {}} />
        </HeaderPanelsProvider>
      </ServiceChooserProvider>,
    );

    expect(screen.queryByRole("button", { name: "Quick actions" })).not.toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    renderChooser();
    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));
    await screen.findByRole("menu");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("keeps only one header panel open at a time", async () => {
    renderChooser();

    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    // Opening the services panel must dismiss the quick-action panel rather
    // than stacking on top of it.
    fireEvent.click(screen.getByRole("button", { name: "Explore services" }));
    await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("opens the services panel from the quick-action menu", async () => {
    renderChooser();

    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Invest in a service/ }));

    expect(
      await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});

describe("header panel interaction model", () => {
  afterEach(() => stubHover(false));

  it("opens on hover and closes again after the grace period", async () => {
    stubHover(true);
    renderChooser();

    const explorer = screen.getByRole("button", { name: "Explore services" });
    fireEvent.pointerEnter(explorer, { pointerType: "mouse" });

    expect(
      await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" }),
    ).toBeInTheDocument();

    fireEvent.pointerLeave(explorer);

    // The grace period is what stops the panel vanishing while the pointer
    // crosses the gap between the trigger and the panel.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Explore Wolf Forge Services" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("hands over directly when the pointer moves to another trigger", async () => {
    stubHover(true);
    renderChooser();

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Explore services" }), {
      pointerType: "mouse",
    });
    await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" });

    fireEvent.pointerLeave(screen.getByRole("button", { name: "Explore services" }));
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Quick actions" }), {
      pointerType: "mouse",
    });

    expect(await screen.findByRole("menu")).toBeInTheDocument();

    // The previous panel is already animating out (and no longer interactive)
    // rather than sitting open behind the new one.
    const previous = screen.queryByRole("dialog", { name: "Explore Wolf Forge Services" });
    expect(previous?.getAttribute("data-phase") ?? "gone").not.toBe("open");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Explore Wolf Forge Services" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("pins on click so hovering away no longer closes it", async () => {
    stubHover(true);
    renderChooser();

    const explorer = screen.getByRole("button", { name: "Explore services" });
    fireEvent.click(explorer);
    await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" });

    fireEvent.pointerLeave(explorer);

    // Still open well past the grace period, because the click pinned it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      screen.getByRole("dialog", { name: "Explore Wolf Forge Services" }),
    ).toBeInTheDocument();
  });

  it("closes a pinned panel when its own trigger is clicked again", async () => {
    stubHover(true);
    renderChooser();

    const explorer = screen.getByRole("button", { name: "Explore services" });
    fireEvent.click(explorer);
    await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" });

    fireEvent.click(explorer);

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Explore Wolf Forge Services" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("closes on an outside pointer press", async () => {
    stubHover(true);
    renderChooser();

    fireEvent.click(screen.getByRole("button", { name: "Explore services" }));
    await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" });

    fireEvent.pointerDown(document.body);

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Explore Wolf Forge Services" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("never opens on hover when the pointer has no hover capability", async () => {
    stubHover(false);
    renderChooser();

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Explore services" }), {
      pointerType: "mouse",
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(
      screen.queryByRole("dialog", { name: "Explore Wolf Forge Services" }),
    ).not.toBeInTheDocument();

    // Tap still opens it.
    fireEvent.click(screen.getByRole("button", { name: "Explore services" }));
    expect(
      await screen.findByRole("dialog", { name: "Explore Wolf Forge Services" }),
    ).toBeInTheDocument();
  });
});
