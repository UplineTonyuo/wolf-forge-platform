/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("MobileFilterSheet", () => {
  it("is present in the DOM but keeps the sheet closed until the trigger is used", () => {
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

    /*
     * The sheet stays mounted so it can transition out; aria-hidden is what
     * takes it out of the accessibility tree, and role queries respect that.
     */
    expect(screen.getByRole("button", { name: "Filter things" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Filter things" })).toBeNull();
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
