/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepartmentOutputs } from "../components/operations/department-outputs";
const resources = [
  { key: "pr", label: "Press Releases", outputUrl: "https://example.com/pr?exact=1#output" },
  { key: "gs", label: "Advance Gstack", outputUrl: "https://example.com/gstack" },
  { key: "ob", label: "Onboarding / Access Sheet", outputUrl: "https://example.com/access" },
];
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("shared Outputs / Resources", () => {
  it("uses named full-row safe links, supports keyboard entry and Escape, and retains a brief inert exit", () => {
    vi.useFakeTimers();
    const inspect = vi.fn();
    render(<div onClick={inspect}><DepartmentOutputs resources={resources} /><button>Next row</button></div>);
    const trigger = screen.getByRole("button", { name: "3 outputs" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("dialog", { name: "Available outputs" });
    const links = within(menu).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(resources.map((r) => r.outputUrl));
    expect(links[0]).toHaveAccessibleName("Press Releases");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(inspect).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(links[0]).toHaveFocus();
    fireEvent.keyDown(links[0]!, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menu).toHaveAttribute("inert");
    expect(menu).toHaveAttribute("data-state", "closing");
    act(() => vi.advanceTimersByTime(140));
    expect(menu).not.toBeInTheDocument();
  });
  it("closes on outside pointer, focus departure, and opening another menu", () => {
    render(<><DepartmentOutputs resources={resources} /><DepartmentOutputs resources={resources} noun="resource" /><button>Outside</button></>);
    const outputs = screen.getByRole("button", { name: "3 outputs" });
    fireEvent.click(outputs);
    fireEvent.click(screen.getByRole("button", { name: "3 resources" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Available resources");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(outputs);
    act(() => screen.getByRole("button", { name: "Outside" }).focus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("anchors above near the viewport bottom and preserves unsafe-link rejection", () => {
    render(<DepartmentOutputs resources={[...resources, { key: "bad", label: "Unsafe", outputUrl: "javascript:alert(1)" }]} />);
    const trigger = screen.getByRole("button", { name: "4 outputs" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 2, right: 80, top: 720, bottom: 750, width: 78, height: 30, x: 2, y: 720, toJSON: () => ({}) });
    fireEvent.click(trigger);
    const menu = screen.getByRole("dialog");
    expect(menu).toHaveAttribute("data-side", "above");
    expect(menu.style.left).toBe("12px");
    expect(menu.style.bottom).toBe("54px");
    expect(within(menu).queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
    expect(within(menu).getByText("Unsafe")).toBeInTheDocument();
  });
});
