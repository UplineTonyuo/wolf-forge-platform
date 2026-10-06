/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompaniesList, type CompanyListRow } from "../components/companies/companies-list";

const companies: CompanyListRow[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Acme Holdings",
    createdAt: "2026-10-06T00:00:00Z",
    createdLabel: "Oct 6, 2026",
    people: [{ id: "p1", name: "Arnold Adolfo Pahl Jr", email: "arnold@example.com", avatarUrl: null }],
  },
  { id: "20000000-0000-4000-8000-000000000002", name: "Beacon Labs", createdAt: "2026-10-05T00:00:00Z", createdLabel: "Oct 5, 2026", people: [] },
];

function visibleNames() {
  return within(screen.getByRole("table")).queryAllByRole("link").map((link) => link.textContent);
}

afterEach(cleanup);

describe("Companies list toolbar", () => {
  it("searches Company name, linked person name and email, and restores the list when cleared", () => {
    render(<CompaniesList companies={companies} canSeePeople canCreate />);
    const search = screen.getByRole("textbox", { name: "Search Companies" });

    fireEvent.change(search, { target: { value: "beacon" } });
    expect(visibleNames()).toEqual(["Beacon Labs"]);

    fireEvent.change(search, { target: { value: "arnold" } });
    expect(visibleNames()).toEqual(["Acme Holdings"]);

    fireEvent.change(search, { target: { value: "ARNOLD@EXAMPLE" } });
    expect(visibleNames()).toEqual(["Acme Holdings"]);

    fireEvent.change(search, { target: { value: "nothing-matches" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No Companies match.");

    fireEvent.change(search, { target: { value: "" } });
    expect(visibleNames()).toEqual(["Acme Holdings", "Beacon Labs"]);
  });

  it("filters by people, clears, and returns focus to Filter on Escape", async () => {
    render(<CompaniesList companies={companies} canSeePeople canCreate />);
    const trigger = screen.getByRole("button", { name: "Filter" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Has people" }));
    expect(visibleNames()).toEqual(["Acme Holdings"]);
    expect(trigger.textContent).toContain("1");

    fireEvent.click(screen.getByRole("button", { name: "No people" }));
    expect(visibleNames()).toEqual(["Beacon Labs"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(visibleNames()).toEqual(["Acme Holdings", "Beacon Labs"]);

    screen.getByRole("button", { name: "All" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull());
  });

  it("shows the person's first name only in the avatar tooltip, never the email", () => {
    render(<CompaniesList companies={companies} canSeePeople canCreate />);
    const avatar = screen.getByTitle("Arnold");
    expect(avatar.getAttribute("title")).toBe("Arnold");
    expect(document.body.innerHTML).not.toContain("arnold@example.com");
  });

  it("routes + Company to /companies/new and hides Filter without private contact access", () => {
    render(<CompaniesList companies={companies} canSeePeople={false} canCreate />);
    expect(screen.getByRole("link", { name: "Company" }).getAttribute("href")).toBe("/companies/new");
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
    expect(screen.getAllByText("Restricted").length).toBeGreaterThan(0);
  });
});
