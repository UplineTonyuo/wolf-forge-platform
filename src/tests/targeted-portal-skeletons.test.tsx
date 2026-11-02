/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ClientRouteSkeleton } from "../components/account/client-route-skeleton";
import forms from "../components/forms/forms.module.css";
import tickets from "../components/tickets/tickets.module.css";

afterEach(cleanup);

it("reserves all six public Project facts without fabricating a start result", () => {
  const { container } = render(<ClientRouteSkeleton pathname="/account/projects/one" />);
  expect(container.querySelector(".portal-fact-grid")?.children).toHaveLength(6);
  expect(container.querySelector("[data-skeleton-block='conversation']")).toBeTruthy();
  expect(container.querySelector("button, input, a, progress")).toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

it("uses a neutral assignment envelope for both forms and receipts before authorized schema is known", () => {
  const { container } = render(<ClientRouteSkeleton pathname="/account/onboarding/assignment" />);
  expect(container.querySelector(`.${forms.clientFormPage}`)).toBeTruthy();
  expect(container.querySelector("[data-skeleton-block='assignment-content']")).toBeTruthy();
  expect(container.querySelector("[data-skeleton-block='intake-form'], label, input, button")).toBeNull();
  expect(container.textContent).not.toMatch(/Submit|Start|Completed|Required/);
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

it("reuses the real thread grid, main column and summary responsive classes", () => {
  const { container } = render(<ClientRouteSkeleton pathname="/account/messages/ticket" />);
  const grid = container.querySelector(`.${tickets.clientDetailGrid}`);
  expect(grid?.querySelector(`.${tickets.detailMain} [data-skeleton-block='conversation']`)).toBeTruthy();
  expect(grid?.querySelector(`aside.${tickets.clientSummary}`)).toBeTruthy();
  expect(grid?.querySelector("[data-skeleton-block='composer']")).toBeTruthy();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(container.querySelector("input, textarea, button, a")).toBeNull();
});
