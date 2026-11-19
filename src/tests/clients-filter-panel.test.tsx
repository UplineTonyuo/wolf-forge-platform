/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/clients",
  useRouter: () => ({ push }),
  useSearchParams: () => params,
}));

const { ClientsFilterPanel } = await import("../components/clients/clients-filter-panel");

const options = [
  { value: "", label: "All", count: 12 },
  { value: "contact", label: "Contact", count: 5 },
  { value: "lead", label: "Lead", count: 3 },
  { value: "client", label: "Client", count: 4 },
  { value: "client_team", label: "Client Team", count: 0 },
];

function openPanel(status = "", query = "", filterOptions = options) {
  const view = render(<ClientsFilterPanel query={query} status={status} options={filterOptions} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter clients" }));
  return { view, dialog: screen.getByRole("dialog", { name: "Filter clients" }) };
}

function apply(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
}

beforeEach(() => {
  push.mockReset();
  params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

describe("Clients filter", () => {
  it("lists renamed lifecycle statuses in workspace order and keeps their filter keys", () => {
    const { dialog } = openPanel("", "", [
      { value: "lead", label: "Prospect", count: 3 },
      { value: "contact", label: "New contact", count: 5 },
      { value: "", label: "All", count: 12 },
    ]);
    const buttons = within(within(dialog).getByRole("group", { name: "Type" })).getAllByRole("button");
    expect(buttons.map(button => button.textContent)).toEqual(["Prospect3", "New contact5", "All12"]);
    fireEvent.click(buttons[0]!);
    apply(dialog);
    expect(push).toHaveBeenCalledWith("/clients?status=lead");
  });
  it("offers only the filters the server applies: search and Type", () => {
    const { dialog } = openPanel();

    expect(within(dialog).getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Type" })).toBeTruthy();
    for (const unwired of [/Assigned manager/, /Pipeline stage/, /Created date/, /Updated date/, /Rows per page/]) {
      expect(within(dialog).queryByText(unwired)).toBeNull();
    }
  });

  it("opens on the applied Type, with the page's own counts", () => {
    const { dialog } = openPanel("client_team");

    expect(within(dialog).getByRole("button", { name: /^Client Team/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe("false");
    expect(within(dialog).getByRole("button", { name: /^Lead/ }).textContent).toContain("3");
    expect(within(dialog).getByRole("button", { name: /^All/ }).textContent).toContain("12");
  });

  it("writes the selected type to the existing `status` param on Apply", () => {
    const { dialog } = openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Client Team/ }));
    apply(dialog);

    expect(push).toHaveBeenCalledWith("/clients?status=client_team");
  });

  it("removes the status param when All is applied", () => {
    params = new URLSearchParams("status=lead");
    const { dialog } = openPanel("lead");
    fireEvent.click(within(dialog).getByRole("button", { name: /^All/ }));
    apply(dialog);

    expect(push).toHaveBeenCalledWith("/clients");
  });

  it("applies the search on Enter", () => {
    const { dialog } = openPanel();
    const search = within(dialog).getByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "  acme  " } });
    fireEvent.submit(search.closest("form")!);

    expect(push).toHaveBeenCalledWith("/clients?q=acme");
  });

  it("carries unrelated params such as `ref` through untouched", () => {
    params = new URLSearchParams("ref=inbox");
    const { dialog } = openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Lead/ }));
    apply(dialog);

    expect(push).toHaveBeenCalledWith("/clients?ref=inbox&status=lead");
  });

  it("clears search and Type together", () => {
    params = new URLSearchParams("q=acme&status=lead");
    const { dialog } = openPanel("lead", "acme");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));

    expect(push).toHaveBeenCalledWith("/clients");
  });

  it("does not navigate when nothing changed", () => {
    params = new URLSearchParams("status=lead");
    const { dialog } = openPanel("lead");
    apply(dialog);

    expect(push).not.toHaveBeenCalled();
  });

  it("badges the trigger with the applied filters, not an unapplied draft", () => {
    render(<ClientsFilterPanel query="acme" status="lead" options={options} />);
    const trigger = screen.getByRole("button", { name: "Filter clients" });
    expect(trigger.textContent).toContain("2");

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Filter clients" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^All/ }));
    expect(trigger.textContent).toContain("2");
  });

  it("portals the modal out of the route subtree at every width", () => {
    const { view, dialog } = openPanel();

    /*
     * .workspace-route-stage carries a transform, so a fixed-position modal
     * left inside it anchors to the route stage instead of the viewport.
     */
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });
});
