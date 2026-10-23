// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormsVisibilityBoundary } from "../components/forms/forms-visibility-boundary";

const original = JSON.stringify({ authority: ["actor", true], recordIds: ["submission:original"] });
const mocks = vi.hoisted(() => ({ load: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../app/actions/forms-visibility", () => ({ loadFormsVisibility: mocks.load }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  mocks.load.mockResolvedValue({ ok: true, signature: original });
});
afterEach(cleanup);
const mount = () => render(<FormsVisibilityBoundary scope="internal" signature={original}><p>Retained response</p></FormsVisibilityBoundary>);

it("redacts a retained response when current authorization is denied", async () => {
  mocks.load.mockResolvedValue({ ok: false, denied: true });
  mount();
  await waitFor(() => expect(screen.queryByText("Retained response")).toBeNull());
  expect(mocks.refresh).toHaveBeenCalled();
});
it("redacts removed response scope even if Forms remains enabled", async () => {
  mocks.load.mockResolvedValue({ ok: true, signature: JSON.stringify({ authority: ["actor", true], recordIds: [] }) });
  mount();
  await waitFor(() => expect(screen.queryByText("Retained response")).toBeNull());
});
it("preserves current form state when an unrelated authorized response is added", async () => {
  mocks.load.mockResolvedValue({ ok: true, signature: JSON.stringify({ authority: ["actor", true], recordIds: ["submission:original", "submission:new"] }) });
  mount();
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  expect(screen.getByText("Retained response")).toBeTruthy();
});
it("does not treat a transport failure as history denial", async () => {
  mocks.load.mockRejectedValue(new Error("Temporary transport failure"));
  mount();
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  expect(screen.getByText("Retained response")).toBeTruthy();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("ignores a delayed denial from the previous actor scope", async () => {
  let resolveOld!: (value: { ok: false; denied: true }) => void;
  mocks.load.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  const view = mount();
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  const next = JSON.stringify({ authority: ["new actor", true], recordIds: ["submission:new"] });
  mocks.load.mockResolvedValue({ ok: true, signature: next });
  view.rerender(<FormsVisibilityBoundary scope="internal" signature={next}><p>New actor response</p></FormsVisibilityBoundary>);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  await act(async () => resolveOld({ ok: false, denied: true }));
  expect(screen.getByText("New actor response")).toBeTruthy();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
