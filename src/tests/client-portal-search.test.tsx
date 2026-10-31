/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientSearch } from "../components/account/command/client-search";
import { HeaderPanelsProvider } from "../components/account/command/header-panels";
import {
  groupResults,
  MATCH_RANK,
  MIN_QUERY_LENGTH,
  normalizeReference,
  rankCandidate,
  rankResults,
  toMessageCandidate,
  toProjectCandidate,
  toServiceCandidate,
  type ClientSearchResult,
} from "../domain/client-portal/search";

const push = vi.hoisted(() => vi.fn());
const searchAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/account",
}));

vi.mock("../app/actions/client-search", () => ({
  clientSearchAction: searchAction,
}));

afterEach(cleanup);

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

/* --- Fixtures ------------------------------------------------------------- */

const gbpProject = toProjectCandidate({
  id: "project-gbp",
  reference: "WF-P0237",
  title: "Google Business Profile optimisation",
  status: "waiting_reply",
  serviceName: "GBP Only SEO",
});

const seoProject = toProjectCandidate({
  id: "project-seo",
  reference: "WF-P0104",
  title: "Local SEO sprint",
  status: "working",
  serviceName: "Local SEO",
});

const homepageTicket = toMessageCandidate({
  ticket_id: "ticket-home",
  public_ref: "WF-TKT-000043",
  subject: "New photos for the homepage",
  status: "waiting_on_client",
});

const reportingTicket = toMessageCandidate({
  ticket_id: "ticket-reporting",
  public_ref: "WF-TKT-000044",
  subject: "Monthly reporting question",
  status: "in_progress",
});

const backlinkService = toServiceCandidate({
  id: "service-backlink",
  name: "Backlink Foundations",
  folderName: "Backlink Service",
  priceLabel: "$500",
  recurringLabel: null,
});

const seoService = toServiceCandidate({
  id: "service-seo",
  name: "Local SEO Starter",
  folderName: "Local SEO",
  priceLabel: "$900",
  recurringLabel: null,
});

const projects = [gbpProject, seoProject];
const messages = [homepageTicket, reportingTicket];
const services = [backlinkService, seoService];

describe("project matching", () => {
  it("finds a project by its exact reference", () => {
    expect(rankResults("WF-P0237", projects).map((r) => r.id)).toEqual(["project-gbp"]);
  });

  it("finds a project by a reference fragment with or without the prefix", () => {
    for (const query of ["WF-P0237", "wf-p0237", "P0237", "0237", "wfp0237"]) {
      expect(rankResults(query, projects).map((r) => r.id)).toEqual(["project-gbp"]);
    }
  });

  it("finds a project by a partial name, case-insensitively", () => {
    expect(rankResults("google business", projects).map((r) => r.id)).toEqual(["project-gbp"]);
    expect(rankResults("OPTIMISATION", projects).map((r) => r.id)).toEqual(["project-gbp"]);
  });

  it("finds a project through its service name", () => {
    // "GBP" appears only on the service, not in the project title.
    expect(rankResults("gbp", projects).map((r) => r.id)).toEqual(["project-gbp"]);
  });

  it("presents the reference and client-safe state, and nothing internal", () => {
    expect(gbpProject.subtitle).toBe("WF-P0237 · Waiting on you");
    expect(gbpProject.href).toBe("/account/projects/project-gbp");

    // The candidate shape has no field capable of carrying internal data.
    expect(Object.keys(gbpProject).sort()).toEqual(
      ["href", "id", "kind", "related", "reference", "subtitle", "title", "tone"].sort(),
    );
  });
});

describe("conversation matching", () => {
  it("finds a conversation by its exact reference", () => {
    expect(rankResults("WF-TKT-000043", messages).map((r) => r.id)).toEqual(["ticket-home"]);
  });

  it("finds a conversation by a reference fragment", () => {
    expect(rankResults("000043", messages).map((r) => r.id)).toEqual(["ticket-home"]);
  });

  it("finds a conversation by subject", () => {
    expect(rankResults("homepage", messages).map((r) => r.id)).toEqual(["ticket-home"]);
    expect(rankResults("monthly reporting", messages).map((r) => r.id)).toEqual([
      "ticket-reporting",
    ]);
  });

  it("cannot match a message body, because none is ever supplied", () => {
    /*
     * The candidate is built from subject and reference only. An internal note
     * has no field on this shape to occupy, so it cannot influence matching,
     * results or metadata even if one were loaded upstream.
     */
    expect("body" in homepageTicket).toBe(false);
    expect(JSON.stringify(homepageTicket)).not.toContain("INTERNAL");

    // A word that would only ever appear inside a message body finds nothing.
    expect(rankResults("confirm scope before replying", messages)).toEqual([]);
  });

  it("links to the existing conversation route", () => {
    expect(homepageTicket.href).toBe("/account/messages/ticket-home");
  });
});

describe("service matching", () => {
  it("preserves the existing predictive behaviour", () => {
    expect(rankResults("seo", services).map((r) => r.id)).toEqual(["service-seo"]);
    expect(rankResults("back", services).map((r) => r.id)).toEqual(["service-backlink"]);
    expect(rankResults("press", services)).toEqual([]);
  });

  it("matches a category name", () => {
    expect(rankResults("Backlink Service", services).map((r) => r.id)).toEqual([
      "service-backlink",
    ]);
  });

  it("links to the existing service detail route", () => {
    expect(backlinkService.href).toBe("/account/store/service-backlink");
  });
});

describe("ranking", () => {
  it("orders exact reference above every weaker match", () => {
    expect(rankCandidate("WF-P0237", gbpProject)).toBe(MATCH_RANK.exactReference);
    expect(rankCandidate("WF-P", gbpProject)).toBe(MATCH_RANK.referenceStartsWith);
    expect(rankCandidate("Google Business Profile optimisation", gbpProject)).toBe(
      MATCH_RANK.exactTitle,
    );
    expect(rankCandidate("google", gbpProject)).toBe(MATCH_RANK.titleStartsWith);
    expect(rankCandidate("business", gbpProject)).toBe(MATCH_RANK.contains);
    expect(rankCandidate("gbp", gbpProject)).toBe(MATCH_RANK.related);
  });

  it("puts the exact reference match first when several rows match", () => {
    const decoy = toProjectCandidate({
      id: "decoy",
      reference: "WF-P0900",
      title: "Notes about WF-P0237 follow-up",
      status: "working",
      serviceName: null,
    });

    expect(rankResults("WF-P0237", [decoy, gbpProject]).map((r) => r.id)).toEqual([
      "project-gbp",
      "decoy",
    ]);
  });

  it("is deterministic and returns nothing for a blank query", () => {
    expect(rankResults("", projects)).toEqual([]);
    expect(rankResults("   ", projects)).toEqual([]);
    expect(rankResults("seo", services)).toEqual(rankResults("seo", services));
  });

  it("normalizes punctuation out of references", () => {
    expect(normalizeReference("WF-P0237")).toBe("wfp0237");
    expect(normalizeReference("wf tkt 000043")).toBe("wftkt000043");
  });

  it("caps each group so one kind cannot crowd out the others", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      toProjectCandidate({
        id: `p${index}`,
        reference: `WF-P${String(index).padStart(4, "0")}`,
        title: `SEO project ${index}`,
        status: "working",
        serviceName: null,
      }),
    );

    expect(rankResults("seo", many)).toHaveLength(5);
  });
});

describe("result grouping", () => {
  it("renders only the sections that have matches, in a fixed order", () => {
    const results = [
      ...rankResults("seo", projects),
      ...rankResults("seo", services),
    ];

    expect(groupResults(results).map((group) => group.label)).toEqual(["Orders", "Services"]);
  });

  it("emits no group at all when nothing matches", () => {
    expect(groupResults([])).toEqual([]);
  });
});

/* --- UI ------------------------------------------------------------------- */

function renderSearch() {
  return render(
    <HeaderPanelsProvider>
      <ClientSearch />
    </HeaderPanelsProvider>,
  );
}

function respondWith(results: ClientSearchResult[], query = "home") {
  searchAction.mockResolvedValue({ ok: true, query, results });
}

async function type(query: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
  return screen.findByRole("dialog", { name: "Search results" });
}

describe("client search panel", () => {
  it("announces the widened scope in its placeholder", () => {
    renderSearch();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "placeholder",
      "Search orders, messages, services...",
    );
  });

  it("does not search below the minimum query length", async () => {
    renderSearch();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "h" } });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(searchAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Search results" })).not.toBeInTheDocument();
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it("renders grouped results with one section per kind", async () => {
    respondWith([
      ...rankResults("home", projects.concat(gbpProject)),
      ...rankResults("homepage", messages),
      ...rankResults("home", services),
    ]);

    renderSearch();
    const panel = await type("homepage");

    await waitFor(() =>
      expect(within(panel).getByText("New photos for the homepage")).toBeInTheDocument(),
    );
    expect(within(panel).getByText("Inbox")).toBeInTheDocument();
    // No heading for a kind with no matches.
    expect(within(panel).queryByText("Services")).not.toBeInTheDocument();
  });

  it("opens the highlighted result with the keyboard alone", async () => {
    respondWith(rankResults("WF-P0237", projects));

    renderSearch();
    const panel = await type("WF-P0237");
    await waitFor(() =>
      expect(
        within(panel).getByText("Google Business Profile optimisation"),
      ).toBeInTheDocument(),
    );

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/account/projects/project-gbp");
  });

  it("states the no-results case concisely", async () => {
    respondWith([]);

    renderSearch();
    const panel = await type("zzzz");

    await waitFor(() =>
      expect(within(panel).getByText(/No results for “zzzz”/)).toBeInTheDocument(),
    );
    expect(within(panel).getByText(/project reference, conversation, or service name/)).toBeInTheDocument();
  });

  it("ignores a stale response that lands after a newer one", async () => {
    const slowFirst = rankResults("seo", services);
    const newest = rankResults("homepage", messages);

    searchAction
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, query: "se", results: slowFirst }), 120),
          ),
      )
      .mockResolvedValueOnce({ ok: true, query: "homepage", results: newest });

    renderSearch();
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "se" } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    fireEvent.change(input, { target: { value: "homepage" } });

    const panel = await screen.findByRole("dialog", { name: "Search results" });
    await waitFor(() =>
      expect(within(panel).getByText("New photos for the homepage")).toBeInTheDocument(),
    );

    // The slower earlier query must not overwrite the newest results.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(within(panel).queryByText("Local SEO Starter")).not.toBeInTheDocument();
    expect(within(panel).getByText("New photos for the homepage")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    respondWith(rankResults("homepage", messages));

    renderSearch();
    await type("homepage");

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Search results" })).not.toBeInTheDocument(),
    );
  });

  it("keeps search inside the shared single-panel manager", async () => {
    respondWith(rankResults("homepage", messages));

    renderSearch();
    const panel = await type("homepage");

    // It is a header panel, not an independent popover with its own manager.
    expect(panel).toHaveClass("portal-header-panel");
    expect(panel.closest("[data-header-panel-root]")).not.toBeNull();
  });
});
