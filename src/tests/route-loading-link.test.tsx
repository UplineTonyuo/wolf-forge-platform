/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, use, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouteTransitionLink, RouteTransitionProvider } from "../components/shell/route-transition";
import { interceptNextLinkNavigation, NextLinkRouter } from "./fixtures/next-link-router";

vi.mock("next/link", async () => (await import("./fixtures/next-link-router")).appLinkModule);

let dispatch: (href: string) => void;
let restore: () => void;
const pushes = vi.fn();
beforeEach(() => { pushes.mockClear(); dispatch = pushes; restore = interceptNextLinkNavigation((href) => dispatch(href)); });
afterEach(() => { cleanup(); restore(); });

it("uses installed Next Link's accepted-navigation callback and preserves the real href", () => {
  const begin = vi.fn();
  render(<NextLinkRouter><RouteTransitionProvider begin={begin}>
    <RouteTransitionLink href="/account/onboarding/required?from=project" prefetch={false}>Pending project</RouteTransitionLink>
  </RouteTransitionProvider></NextLinkRouter>);
  fireEvent.click(screen.getByRole("link"));
  expect(begin.mock.calls[0]?.[0].pathname).toBe("/account/onboarding/required");
  expect(begin.mock.calls[0]?.[0].search).toBe("?from=project");
  expect(pushes).toHaveBeenCalledWith("/account/onboarding/required?from=project");
});

it.each([
  [{ ctrlKey: true }, {}], [{ metaKey: true }, {}], [{ shiftKey: true }, {}], [{ altKey: true }, {}],
  [{}, { target: "_blank" }], [{}, { download: "receipt" }],
])("does not begin loading for browser-handled click %j / %j", (options, attributes) => {
  const begin = vi.fn();
  render(<NextLinkRouter><RouteTransitionProvider begin={begin}>
    <RouteTransitionLink href="/account/projects/one" prefetch={false} {...attributes}>Open</RouteTransitionLink>
  </RouteTransitionProvider></NextLinkRouter>);
  fireEvent.click(screen.getByRole("link"), options);
  expect(begin).not.toHaveBeenCalled();
  expect(pushes).not.toHaveBeenCalled();
});

it.each(["click", "navigate"])("preserves custom cancellation in on%s without a pending route", (phase) => {
  const begin = vi.fn();
  render(<NextLinkRouter><RouteTransitionProvider begin={begin}>
    <RouteTransitionLink href="/account/projects/one" prefetch={false}
      onClick={phase === "click" ? (event) => event.preventDefault() : undefined}
      onNavigate={phase === "navigate" ? (event) => event.preventDefault() : undefined}>Open</RouteTransitionLink>
  </RouteTransitionProvider></NextLinkRouter>);
  fireEvent.click(screen.getByRole("link"));
  expect(begin).not.toHaveBeenCalled();
  expect(pushes).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

const loaded = Object.assign(Promise.resolve(), { status: "fulfilled" as const, value: undefined });
const payloads = new Map<string, () => void>();
function Section({ href, ready }: { href: string; ready: Promise<void> }) {
  use(ready);
  return <><h1>Committed {href}</h1><input aria-label="Draft" defaultValue="Keep draft" />
    <RouteTransitionLink href="/clients/one?tab=projects" feedback="inline" loadingLabel="Loading Projects" prefetch={false}>Projects</RouteTransitionLink>
    <RouteTransitionLink href="/clients/one?tab=history" feedback="inline" loadingLabel="Loading History" prefetch={false}>History</RouteTransitionLink>
    <RouteTransitionLink href="/clients/one" feedback="inline" loadingLabel="Loading Details" prefetch={false}>Details</RouteTransitionLink>
  </>;
}
function QueryRouter() {
  const [state, setState] = useState({ href: "/clients/one", ready: loaded as Promise<void> });
  useEffect(() => { dispatch = (href) => {
    const ready = new Promise<void>((resolve) => payloads.set(href, resolve));
    setState({ href, ready });
  }; }, []);
  return <NextLinkRouter><Suspense fallback={<p>Outer fallback</p>}><Section {...state} /></Suspense></NextLinkRouter>;
}

it("keeps committed query content and draft while only the latest section Link reports pending", async () => {
  render(<QueryRouter />);
  const draft = screen.getByRole("textbox");
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "History" })));
  expect(screen.getByRole("heading")).toHaveTextContent("Committed /clients/one");
  expect(screen.getByRole("status")).toHaveTextContent("Loading History");
  expect(draft).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "Projects" })));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Loading Projects");
  await act(async () => payloads.get("/clients/one?tab=projects")!());
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("heading")).toHaveTextContent("?tab=projects");
  await act(async () => payloads.get("/clients/one?tab=history")!());
  expect(screen.getByRole("heading")).toHaveTextContent("?tab=projects");
});

it("cancels A -> B -> A without dropping the mounted draft or leaving a busy hint", async () => {
  render(<QueryRouter />);
  const draft = screen.getByRole("textbox");
  fireEvent.change(draft, { target: { value: "Unsent" } });
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "History" })));
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "Details" })));
  await act(async () => payloads.get("/clients/one")!());
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft).toHaveValue("Unsent");
  await act(async () => payloads.get("/clients/one?tab=history")!());
  expect(screen.getByRole("heading")).toHaveTextContent("Committed /clients/one");
});

it("does not force a loading state on synchronous cached navigation", async () => {
  const begin = vi.fn();
  render(<NextLinkRouter><RouteTransitionProvider begin={begin}>
    <RouteTransitionLink href="/clients/one?tab=history" feedback="inline" prefetch={false}>History</RouteTransitionLink>
  </RouteTransitionProvider></NextLinkRouter>);
  await act(async () => fireEvent.click(screen.getByRole("link")));
  expect(begin).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});
