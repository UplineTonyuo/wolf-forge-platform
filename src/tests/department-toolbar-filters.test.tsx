/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DepartmentToolbarFilters } from "../components/operations/department-toolbar-filters";

afterEach(cleanup);

function FiltersHarness() {
  const [packageFilter, setPackageFilter] = useState("Starter");
  return (
    <>
      <DepartmentToolbarFilters
        groups={[{
          key: "package",
          label: "Package",
          allLabel: "All Packages",
          ariaLabel: "Filter by SEO package",
          value: packageFilter,
          options: ["Starter", "Growth"],
          onChange: setPackageFilter,
        }]}
      />
      <button type="button">Outside</button>
    </>
  );
}

describe("DepartmentToolbarFilters", () => {
  it("opens from the keyboard, focuses and selects options, and restores trigger focus on Escape", async () => {
    render(<FiltersHarness />);
    const trigger = screen.getByRole("button", { name: /^Filters/ });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "Enter" });
    const panel = await screen.findByRole("dialog", { name: "Filters" });
    const selectedOption = within(panel).getByRole("button", { name: "Starter" });
    await waitFor(() => expect(selectedOption).toHaveFocus());

    fireEvent.keyDown(selectedOption, { key: "ArrowDown" });
    const growthOption = within(panel).getByRole("button", { name: "Growth" });
    expect(growthOption).toHaveFocus();
    fireEvent.keyDown(growthOption, { key: "Enter" });

    expect(trigger).toHaveTextContent("Filters · 1");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: " " });
    const reopenedPanel = await screen.findByRole("dialog", { name: "Filters" });
    await waitFor(() => expect(within(reopenedPanel).getByRole("button", { name: "Growth" })).toHaveFocus());
    fireEvent.keyDown(within(reopenedPanel).getByRole("button", { name: "Growth" }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("preserves pointer selection and outside-click closing", async () => {
    render(<FiltersHarness />);
    const trigger = screen.getByRole("button", { name: /^Filters/ });

    fireEvent.click(trigger);
    let panel = await screen.findByRole("dialog", { name: "Filters" });
    fireEvent.click(within(panel).getByRole("button", { name: "All Packages" }));
    expect(trigger).toHaveTextContent("Filters");
    expect(trigger).not.toHaveTextContent("Filters · 1");

    fireEvent.click(trigger);
    panel = await screen.findByRole("dialog", { name: "Filters" });
    expect(panel).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
  });
});
