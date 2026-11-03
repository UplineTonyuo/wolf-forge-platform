/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalDialog } from "../components/account/ui/portal-dialog";
import { AnimatedSelect } from "../components/ui/animated-select";
import { DatePicker } from "../components/ui/date-picker";

afterEach(cleanup);

describe("PortalDialog nested popup Escape handling", () => {
  it("lets the payment-method listbox consume Escape before closing the parent", async () => {
    const close = vi.fn();
    render(<PortalDialog open onClose={close} title="Report payment">
      <AnimatedSelect name="method" label="Payment method" menuLabel="Payment methods"
        value="paypal" onChange={() => {}}
        options={[{ value: "paypal", label: "PayPal" }, { value: "bank", label: "Bank transfer" }]} />
    </PortalDialog>);
    const trigger = screen.getByRole("button", { name: "Payment method: PayPal" });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Payment methods" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Report payment" })).toBeTruthy();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the date calendar and restores its trigger before parent Escape", async () => {
    const close = vi.fn();
    render(<PortalDialog open onClose={close} title="Review payment">
      <DatePicker name="paid_at" label="Date paid" menuLabel="Payment date"
        value="2026-10-31" onChange={() => {}} />
    </PortalDialog>);
    const trigger = screen.getByRole("button", { name: "Date paid: Oct 31, 2026" });
    fireEvent.click(trigger);
    const calendar = await screen.findByRole("dialog", { name: "Payment date" });
    const grid = screen.getByRole("grid", { name: "Day grid" });
    expect(calendar.contains(grid)).toBe(true);

    fireEvent.keyDown(grid, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Payment date" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("dialog", { name: "Review payment" })).toBeTruthy();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
