/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "../components/ui/date-picker";
import { RouteTransitionProvider } from "../components/shell/route-transition";

const push = vi.fn();
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/coupons",
  useRouter: () => ({ push }),
  useSearchParams: () => params,
}));

const { MobileFilterSheet, MobilePickerSheet, FilterOptionGroup } = await import(
  "../components/ui/mobile-filter-sheet"
);
const { CouponsFilter } = await import("../components/coupons/coupons-filter");

function openTrigger(name = "Filter coupons") {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  push.mockReset();
  params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSheet(props: { alwaysVisible?: boolean } = {}) {
  return render(
    <MobileFilterSheet label="Filter things" onClear={() => {}} onApply={() => {}} {...props}>
      <input aria-label="Name" type="search" />
      <FilterOptionGroup
        label="Status"
        value="a"
        onChange={() => {}}
        options={[{ value: "a", label: "Alpha" }]}
      />
    </MobileFilterSheet>,
  );
}

describe("MobileFilterSheet", () => {
  it("renders no sheet until the trigger is used", () => {
    renderSheet();

    expect(screen.getByRole("button", { name: "Filter things" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Filter things", hidden: true })).toBeNull();
  });

  it("stays mounted through its exit, out of the accessibility tree, then leaves the DOM", async () => {
    renderSheet();
    openTrigger("Filter things");
    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));

    /* Mid-exit: still in the DOM so the transition can play, but hidden and inert. */
    const leaving = screen.getByRole("dialog", { name: "Filter things", hidden: true });
    expect(leaving.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(leaving.parentElement?.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Filter things" })).toBeNull();

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Filter things", hidden: true })).toBeNull(),
    );
  });

  it("moves focus to the first control, keeps Tab inside, and returns focus to the trigger", () => {
    renderSheet();
    const trigger = screen.getByRole("button", { name: "Filter things" });
    trigger.focus();
    openTrigger("Filter things");

    const dialog = screen.getByRole("dialog", { name: "Filter things" });
    const first = within(dialog).getByRole("button", { name: "Close filters" });
    const last = within(dialog).getByRole("button", { name: "Apply" });
    expect(document.activeElement).toBe(within(dialog).getByRole("searchbox", { name: "Name" }));

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("applies on Enter from a field inside the sheet", () => {
    const onApply = vi.fn();
    render(
      <MobileFilterSheet label="Filter things" onClear={() => {}} onApply={onApply}>
        <input aria-label="Name" type="search" />
      </MobileFilterSheet>,
    );
    openTrigger("Filter things");

    fireEvent.submit(screen.getByRole("searchbox", { name: "Name" }).closest("form")!);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Filter things" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("is mobile-only unless the page says it is the only filter entry point", () => {
    const view = renderSheet();
    expect(screen.getByRole("button", { name: "Filter things" }).className).not.toMatch(/triggerAlways/);

    view.unmount();
    renderSheet({ alwaysVisible: true });
    expect(screen.getByRole("button", { name: "Filter things" }).className).toMatch(/triggerAlways/);
  });

  it("portals the open sheet out of the rendered tree so route transforms cannot clip it", () => {
    const view = render(
      <MobileFilterSheet label="Filter things" onClear={() => {}} onApply={() => {}}>
        <FilterOptionGroup
          label="Status"
          value="a"
          onChange={() => {}}
          options={[{ value: "a", label: "Alpha" }]}
        />
      </MobileFilterSheet>,
    );

    openTrigger("Filter things");

    const dialog = screen.getByRole("dialog", { name: "Filter things" });
    expect(view.container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it("reseads the draft from the applied value each time it opens", () => {
    const onOpen = vi.fn();

    render(
      <MobileFilterSheet label="Filter things" onOpen={onOpen} onClear={() => {}} onApply={() => {}}>
        <FilterOptionGroup
          label="Status"
          value="a"
          onChange={() => {}}
          options={[{ value: "a", label: "Alpha" }]}
        />
      </MobileFilterSheet>,
    );

    openTrigger("Filter things");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("clears and applies through the caller, then closes", () => {
    const onClear = vi.fn();
    const onApply = vi.fn();

    render(
      <MobileFilterSheet label="Filter things" onClear={onClear} onApply={onApply}>
        <FilterOptionGroup
          label="Status"
          value="a"
          onChange={() => {}}
          options={[{ value: "a", label: "Alpha" }]}
        />
      </MobileFilterSheet>,
    );

    openTrigger("Filter things");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);

    openTrigger("Filter things");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Filter things" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape", () => {
    render(
      <MobileFilterSheet label="Filter things" onClear={() => {}} onApply={() => {}}>
        <FilterOptionGroup
          label="Status"
          value="a"
          onChange={() => {}}
          options={[{ value: "a", label: "Alpha" }]}
        />
      </MobileFilterSheet>,
    );

    openTrigger("Filter things");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("button", { name: "Filter things" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("dismisses a nested calendar before the sheet without applying or changing the date", async () => {
    const onApply = vi.fn(); const onDateChange = vi.fn();
    render(<MobileFilterSheet label="Filter dates" onClear={() => {}} onApply={onApply}>
      <DatePicker name="due" label="Due date" menuLabel="Choose due date" value="2026-10-24" onChange={onDateChange} />
    </MobileFilterSheet>);
    openTrigger("Filter dates");
    const outer = screen.getByRole("dialog", { name: "Filter dates" });
    const trigger = within(outer).getByRole("button", { name: "Due date: Oct 24, 2026" });
    fireEvent.click(trigger);
    const calendar = within(outer).getByRole("dialog", { name: "Choose due date" });
    expect(fireEvent.keyDown(within(calendar).getByRole("button", { name: "Next month" }), { key: "Escape" })).toBe(false);
    expect(screen.getByRole("dialog", { name: "Filter dates" })).toBe(outer);
    await waitFor(() => expect(within(outer).queryByRole("dialog", { name: "Choose due date" })).toBeNull());
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filter dates" })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it("renders authoritative counts only where the caller supplies one", () => {
    render(
      <MobileFilterSheet label="Filter things" onClear={() => {}} onApply={() => {}}>
        <FilterOptionGroup
          label="Status"
          value="a"
          onChange={() => {}}
          options={[
            { value: "a", label: "Alpha", count: 4 },
            { value: "b", label: "Beta" },
          ]}
        />
      </MobileFilterSheet>,
    );

    openTrigger("Filter things");
    const dialog = screen.getByRole("dialog", { name: "Filter things" });

    expect(within(dialog).getByRole("button", { name: /Alpha/ }).textContent).toContain("4");
    expect(within(dialog).getByRole("button", { name: /Beta/ }).textContent).not.toMatch(/\d/);
  });
});

describe("CouponsFilter", () => {
  it("starts destination feedback before mobile Apply dispatches the new collection", () => {
    const events: string[] = [];
    const begin = vi.fn((url: URL) => events.push(url.pathname + url.search));
    push.mockImplementation(() => events.push("push"));
    render(<RouteTransitionProvider begin={begin}><CouponsFilter initialView="active" /></RouteTransitionProvider>);
    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(events).toEqual(["/coupons?view=archived", "push"]);
  });
  it("also starts loading feedback when mobile Clear returns to Active", () => {
    params = new URLSearchParams("view=archived");
    const begin = vi.fn();
    render(<RouteTransitionProvider begin={begin}><CouponsFilter initialView="archived" /></RouteTransitionProvider>);
    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(begin.mock.calls[0]?.[0].pathname).toBe("/coupons");
    expect(begin.mock.calls[0]?.[0].search).toBe("");
  });
  it("offers only the two canonical views -- there is no All", () => {
    render(<CouponsFilter initialView="active" />);
    openTrigger();

    const dialog = screen.getByRole("dialog", { name: "Filter coupons" });
    expect(within(dialog).getByRole("button", { name: "Active" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Archived" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "All" })).toBeNull();
  });

  it("writes the existing view=archived param on Apply", () => {
    render(<CouponsFilter initialView="active" />);
    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(push).toHaveBeenCalledWith("/coupons?view=archived");
  });

  it("removes the param when Active is applied", () => {
    params = new URLSearchParams("view=archived");
    render(<CouponsFilter initialView="archived" />);
    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(push).toHaveBeenCalledWith("/coupons");
  });

  it("carries the search through untouched", () => {
    params = new URLSearchParams("q=SPRING");
    render(<CouponsFilter initialView="active" />);
    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const target = push.mock.calls.at(-1)?.[0] as string;
    const next = new URLSearchParams(target.split("?")[1]);
    expect(next.get("q")).toBe("SPRING");
    expect(next.get("view")).toBe("archived");
  });

  it("returns to Active on Clear", () => {
    params = new URLSearchParams("view=archived");
    render(<CouponsFilter initialView="archived" />);
    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(push).toHaveBeenCalledWith("/coupons");
  });

  it("badges the trigger while Archived is the applied view", () => {
    params = new URLSearchParams("view=archived");
    render(<CouponsFilter initialView="archived" />);

    expect(screen.getByRole("button", { name: "Filter coupons" }).textContent).toContain("1");
  });
});

describe("MobilePickerSheet", () => {
  function renderPicker(onSelect = vi.fn(), onClose = vi.fn()) {
    render(
      <MobilePickerSheet
        open
        onClose={onClose}
        label="Select folder"
        eyebrow="SERVICE FOLDERS"
        closeLabel="Close folder picker"
        value="a"
        onSelect={onSelect}
        options={[
          { value: "a", label: "Alpha", count: 3 },
          { value: "b", label: "Beta", count: 7 },
        ]}
      />,
    );
    return { onSelect, onClose, dialog: screen.getByRole("dialog", { name: "Select folder" }) };
  }

  it("lists every option with its authoritative count and marks the selected one", () => {
    const { dialog } = renderPicker();

    expect(within(dialog).getByRole("button", { name: /Alpha/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByRole("button", { name: /Alpha/ }).textContent).toContain("3");
    expect(within(dialog).getByRole("button", { name: /Beta/ }).getAttribute("aria-pressed")).toBe("false");
    expect(within(dialog).getByRole("button", { name: /Beta/ }).textContent).toContain("7");
  });

  it("selects immediately and closes -- there is no Apply or Clear to stage", () => {
    const { onSelect, onClose } = renderPicker();

    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));

    expect(onSelect).toHaveBeenCalledWith("b");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the sheet heading as a group label", () => {
    const { dialog } = renderPicker();

    expect(dialog.querySelectorAll("[role='group']").length).toBe(1);
    expect(within(dialog).getAllByText("Select folder").length).toBe(1);
  });
});
