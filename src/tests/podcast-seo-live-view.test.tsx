/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PodcastOperationItem } from "../domain/operations/podcast-workflow";
import { PodcastSeoLiveView } from "../components/operations/podcast-seo-live-view";

afterEach(cleanup);

function item(overrides: Partial<PodcastOperationItem> = {}): PodcastOperationItem {
  return {
    id: "1",
    sourceMonth: "PODCAST AUGUST 2026",
    sourceSection: "Podcast SEO",
    clientName: "seeitgonejunkremoval.com",
    email: null,
    loginUrl: null,
    orderNumber: null,
    rawSeoPackage: "Growth",
    workLabel: "Growth 4/4",
    primaryKeyword: null,
    city: null,
    promptSopUrl: null,
    podcastUrl: null,
    normalizedStatus: "completed",
    rawStatus: "Completed",
    notes: null,
    assignedVa: "Jordan",
    ...overrides,
  };
}

type JsonResponse = { ok: true; version: string } | { ok: true; data: unknown };

function jsonResponse(body: JsonResponse): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function table(): HTMLElement {
  return screen.getByRole("table");
}

/*
 * Real timers, not fake ones. `usePodcastLiveSync` mixes `setTimeout`
 * scheduling with genuinely async `fetch` calls and React state updates;
 * driving that combination through `vi.useFakeTimers()` plus Testing
 * Library's `waitFor` (which itself polls on a timer) proved to deadlock —
 * the two timer sources fought each other. A few real seconds of wall clock
 * per test is a small, reliable price for exercising the actual poll ->
 * debounce -> refetch sequence end to end.
 */
const REAL_TIMEOUT_MS = 10_000;

describe("PodcastSeoLiveView — near-realtime invalidation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it(
    "polls the version endpoint, and on a changed version debounces one refetch that updates the table",
    async () => {
      let versionCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/version")) {
          versionCalls += 1;
          return jsonResponse({ ok: true, version: versionCalls === 1 ? "v1" : "v2" });
        }
        if (url.includes("/snapshot")) {
          return jsonResponse({
            ok: true,
            data: {
              items: [item({ id: "1", normalizedStatus: "in_progress", rawStatus: "In Progress" })],
              sourceMonth: "PODCAST AUGUST 2026",
              lastSyncedAt: new Date().toISOString(),
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(
        <PodcastSeoLiveView
          initialItems={[item({ id: "1", normalizedStatus: "completed", rawStatus: "Completed" })]}
          initialSourceMonth="PODCAST AUGUST 2026"
          initialLastSyncedAt={new Date().toISOString()}
          initialVaOptions={["Jordan"]}
        />,
      );

      expect(within(table()).getByText("Completed")).toBeInTheDocument();

      await waitFor(() => expect(within(table()).getByText("In Progress")).toBeInTheDocument(), {
        timeout: REAL_TIMEOUT_MS,
      });
      expect(within(table()).queryByText("Completed")).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/snapshot"))).toHaveLength(1);
    },
    REAL_TIMEOUT_MS + 2_000,
  );

  it(
    "preserves an in-progress search filter across a background refresh",
    async () => {
      let versionCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/version")) {
          versionCalls += 1;
          return jsonResponse({ ok: true, version: versionCalls === 1 ? "v1" : "v2" });
        }
        if (url.includes("/snapshot")) {
          return jsonResponse({
            ok: true,
            data: {
              items: [
                item({ id: "1", clientName: "Acme Co", normalizedStatus: "completed" }),
                item({ id: "2", clientName: "seeitgonejunkremoval.com", normalizedStatus: "in_progress" }),
              ],
              sourceMonth: "PODCAST AUGUST 2026",
              lastSyncedAt: new Date().toISOString(),
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(
        <PodcastSeoLiveView
          initialItems={[
            item({ id: "1", clientName: "Acme Co", normalizedStatus: "completed" }),
            item({ id: "2", clientName: "seeitgonejunkremoval.com", normalizedStatus: "completed" }),
          ]}
          initialSourceMonth="PODCAST AUGUST 2026"
          initialLastSyncedAt={new Date().toISOString()}
          initialVaOptions={["Jordan"]}
        />,
      );

      fireEvent.change(screen.getByLabelText("Search Podcast SEO work"), {
        target: { value: "seeitgone" },
      });
      expect(within(table()).queryByText("Acme Co")).not.toBeInTheDocument();
      expect(within(table()).getByText("seeitgonejunkremoval.com")).toBeInTheDocument();

      await waitFor(
        () =>
          expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/snapshot"))).toHaveLength(1),
        { timeout: REAL_TIMEOUT_MS },
      );

      // The refreshed data now has an in-progress status count > 0, proving
      // the refetch landed, while the search filter (local component state,
      // untouched by the prop update) still hides Acme Co the whole time.
      await waitFor(() => expect(within(table()).getByText("seeitgonejunkremoval.com")).toBeInTheDocument());
      expect(within(table()).queryByText("Acme Co")).not.toBeInTheDocument();
    },
    REAL_TIMEOUT_MS + 2_000,
  );

  it(
    "leaves the last known good snapshot on screen when a background refetch fails",
    async () => {
      let versionCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/version")) {
          versionCalls += 1;
          return jsonResponse({ ok: true, version: versionCalls === 1 ? "v1" : "v2" });
        }
        if (url.includes("/snapshot")) {
          return new Response("Session expired.", { status: 401 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(
        <PodcastSeoLiveView
          initialItems={[item({ id: "1", normalizedStatus: "completed" })]}
          initialSourceMonth="PODCAST AUGUST 2026"
          initialLastSyncedAt={new Date().toISOString()}
          initialVaOptions={["Jordan"]}
        />,
      );

      await waitFor(
        () =>
          expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/snapshot"))).toHaveLength(1),
        { timeout: REAL_TIMEOUT_MS },
      );

      // No crash, no blank/loading state — the original row is still shown.
      expect(within(table()).getByText("Completed")).toBeInTheDocument();
    },
    REAL_TIMEOUT_MS + 2_000,
  );
});
