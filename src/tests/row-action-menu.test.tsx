/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowActionMenu } from "../components/ui/row-action-menu";

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

afterEach(cleanup);

describe("RowActionMenu", () => {
  it("opens a link item, focuses it, and returns focus to the trigger on Escape", async () => {
    render(<RowActionMenu name="Acme" items={[{ label: "Open company", href: "/companies/1" }]} />);
    const trigger = screen.getByRole("button", { name: "Actions for Acme" });

    fireEvent.click(trigger);
    const item = screen.getByRole("menuitem", { name: "Open company" });
    expect(item.getAttribute("href")).toBe("/companies/1");
    await waitFor(() => expect(document.activeElement).toBe(item));

    fireEvent.keyDown(item, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("keeps focus on the trigger when Escape lands before the open-focus frame", async () => {
    render(<RowActionMenu name="Acme" items={[{ label: "Edit", href: "/clients/1" }]} />);
    const trigger = screen.getByRole("button", { name: "Actions for Acme" });

    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    await nextFrame();

    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("passes the trigger to a button item so a dialog can restore focus to it", () => {
    const onSelect = vi.fn();
    render(<RowActionMenu name="Acme" items={[{ label: "Edit company", onSelect }]} />);
    const trigger = screen.getByRole("button", { name: "Actions for Acme" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit company" }));
    expect(onSelect).toHaveBeenCalledWith(trigger);
  });
});
