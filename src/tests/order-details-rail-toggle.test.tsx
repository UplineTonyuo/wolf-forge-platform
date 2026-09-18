/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RailDetailsToggle } from "../components/projects/order-details-rail-toggle";

afterEach(cleanup);

it("native details toggle: collapsed by default, click reveals content, click again hides it, aria-expanded tracks state", async () => {
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);

  render(
    <RailDetailsToggle>
      <p>Order details content</p>
    </RailDetailsToggle>,
  );

  const summary = screen.getByText("Details").closest("summary") as HTMLElement;
  const details = summary.closest("details") as HTMLDetailsElement;

  expect(details.open).toBe(false);
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("Order details content")).not.toBeVisible();

  fireEvent.click(summary);
  await waitFor(() => expect(details.open).toBe(true));
  await waitFor(() => expect(summary).toHaveAttribute("aria-expanded", "true"));
  expect(screen.getByText("Order details content")).toBeVisible();

  fireEvent.click(summary);
  await waitFor(() => expect(details.open).toBe(false));
  await waitFor(() => expect(summary).toHaveAttribute("aria-expanded", "false"));
  expect(screen.getByText("Order details content")).not.toBeVisible();

  vi.unstubAllGlobals();
});

it("forces the details open at desktop widths for correct aria-expanded semantics", async () => {
  const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);

  render(
    <RailDetailsToggle>
      <p>Order details content</p>
    </RailDetailsToggle>,
  );

  const summary = screen.getByText("Details").closest("summary") as HTMLElement;
  const details = summary.closest("details") as HTMLDetailsElement;

  await waitFor(() => expect(details.open).toBe(true));
  await waitFor(() => expect(summary).toHaveAttribute("aria-expanded", "true"));

  vi.unstubAllGlobals();
});
