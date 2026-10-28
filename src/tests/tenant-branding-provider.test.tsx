/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readRuntimeBranding, TenantBrandingProvider, TenantBrandingScope, useRuntimeBranding,
} from "../components/shell/tenant-branding-provider";
import { tenantBranding } from "../components/shell/tenant-branding";
import type { RuntimeWhiteLabelConfiguration } from "../domain/white-label/publication";

const tenantA: RuntimeWhiteLabelConfiguration = {
  kind: "published", configuration: {
    tenantId: "aaaaaaaa-0000-4000-8000-000000000001", publicationRevision: 1, sourceDraftRevision: 4,
    displayName: "Tenant A", primaryColor: "#173c32", accentColor: "#d2b777",
    moduleKeys: ["services"], publishedAt: "2026-10-13T12:00:00Z",
  },
};
const tenantB: RuntimeWhiteLabelConfiguration = {
  kind: "published", configuration: {
    ...tenantA.configuration, tenantId: "bbbbbbbb-0000-4000-8000-000000000002", displayName: "Tenant B",
  },
};
const updated: RuntimeWhiteLabelConfiguration = {
  kind: "published", configuration: { ...tenantA.configuration, publicationRevision: 2, displayName: "Updated A" },
};

function deferred() {
  let resolve!: (configuration: RuntimeWhiteLabelConfiguration) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RuntimeWhiteLabelConfiguration>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let hidden = false;
let hiddenDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (hiddenDescriptor) Object.defineProperty(document, "hidden", hiddenDescriptor);
  else Reflect.deleteProperty(document, "hidden");
  vi.unstubAllGlobals();
});

describe("publication observation", () => {
  it("checks on mount and uses a ten-minute fallback while visible", async () => {
    const read = vi.fn().mockResolvedValue(updated);
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a:tenant-a", true, read));
    expect(result.current.branding?.name).toBe("Tenant A");
    expect(read).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.branding?.name).toBe("Updated A");
    await act(() => vi.advanceTimersByTimeAsync(599_999));
    expect(read).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps one request in flight and coalesces repeated focus/resume into one follow-up", async () => {
    const pending = deferred();
    const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(updated);
    renderHook(() => useRuntimeBranding(tenantA, "actor-a:tenant-a", true, read));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(updated); });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("makes no hidden-tab reads and refreshes on return", async () => {
    const read = vi.fn().mockResolvedValue(updated);
    hidden = true;
    renderHook(() => useRuntimeBranding(tenantA, "actor-a:tenant-a", true, read));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(1_800_000);
    });
    expect(read).not.toHaveBeenCalled();
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("drops a pending focus refresh when the tab hides before settlement", async () => {
    const pending = deferred();
    const read = vi.fn().mockReturnValue(pending.promise);
    renderHook(() => useRuntimeBranding(tenantA, "actor-a:tenant-a", true, read));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    hidden = true;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); pending.resolve(updated); });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("discards an old Tenant's late result after new scope props arrive", async () => {
    const pending = deferred();
    const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(tenantB);
    const { result, rerender } = renderHook(({ configuration, actor }) => useRuntimeBranding(configuration, actor, true, read), {
      initialProps: { configuration: tenantA, actor: "actor-a" },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    rerender({ configuration: tenantB, actor: "actor-b" });
    expect(result.current.branding?.name).toBe("Tenant B");
    await act(async () => { pending.resolve(updated); });
    expect(result.current.branding?.name).toBe("Tenant B");
    expect(result.current.unavailable).toBe(false);
  });

  it("discards an old actor's late failure even when the Tenant stays the same", async () => {
    const pending = deferred();
    const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(tenantA);
    const { result, rerender } = renderHook(({ actor }) => useRuntimeBranding(tenantA, actor, true, read), {
      initialProps: { actor: "actor-a" },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    rerender({ actor: "actor-b" });
    await act(async () => { pending.reject(new Error("permission denied")); });
    expect(result.current.branding?.name).toBe("Tenant A");
    expect(result.current.unavailable).toBe(false);
  });

  it("does not accept a response for another selected Tenant", async () => {
    const read = vi.fn().mockResolvedValue(tenantB);
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a", true, read));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current).toEqual({ branding: null, unavailable: true });
  });

  it.each([new Error("transport failure"), new Error("permission denied")])("clears branded projections into explicit unavailable state after %s", async (error) => {
    const read = vi.fn().mockRejectedValue(error);
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a", true, read));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current).toEqual({ branding: null, unavailable: true });
  });

  it("rejects unknown runtime kinds rather than interpreting them as no publication", async () => {
    const read = vi.fn().mockResolvedValue({ kind: "draft" });
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a", true, read));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.branding).toBeNull();
  });

  it("never downgrades to an older revision", async () => {
    const read = vi.fn().mockResolvedValueOnce(updated).mockResolvedValueOnce(tenantA);
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a", true, read));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(600_000));
    expect(result.current.branding?.name).toBe("Updated A");
  });

  it("does not let stale layout props or later reads downgrade an observed revision", async () => {
    const read = vi.fn().mockResolvedValueOnce(updated).mockResolvedValue(tenantA);
    const { result, rerender } = renderHook(({ initial }) => useRuntimeBranding(initial, "actor-a", true, read), {
      initialProps: { initial: tenantA },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    rerender({ initial: structuredClone(tenantA) });
    expect(result.current.branding?.name).toBe("Updated A");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.branding?.name).toBe("Updated A");
  });

  it("can observe the first publication from unpublished defaults", async () => {
    const initial: RuntimeWhiteLabelConfiguration = { kind: "unpublished", tenantId: tenantA.configuration.tenantId, publicationRevision: 0 };
    const read = vi.fn().mockResolvedValue(tenantA);
    const { result } = renderHook(() => useRuntimeBranding(initial, "actor-a", true, read));
    expect(result.current.branding).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.branding?.name).toBe("Tenant A");
  });

  it("keeps a failed initial read explicit and can recover through a fresh read", async () => {
    const read = vi.fn().mockResolvedValue(tenantA);
    const { result } = renderHook(() => useRuntimeBranding(null, "actor-a", true, read));
    expect(result.current).toEqual({ branding: null, unavailable: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.branding?.name).toBe("Tenant A");
    expect(result.current.unavailable).toBe(false);
  });

  it("clears the old brand when a newer legacy publication supersedes it", async () => {
    const read = vi.fn().mockResolvedValue({ kind: "legacy_modules", tenantId: tenantA.configuration.tenantId, publicationRevision: 2, moduleKeys: ["services"] });
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a", true, read));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current).toEqual({ branding: null, unavailable: false });
  });

  it("does not poll a control-plane surface", async () => {
    const read = vi.fn().mockResolvedValue(updated);
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a", false, read));
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(60_000); });
    expect(read).not.toHaveBeenCalled();
    expect(result.current.branding).toBeNull();
  });
});

describe("same-origin branding reader", () => {
  it("uses a fresh private GET and the producer decoder", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(tenantA), { headers: { "x-wf-branding-actor": "actor-a" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await readRuntimeBranding("actor-a")).toEqual(tenantA);
    expect(fetcher).toHaveBeenCalledWith("/api/white-label/runtime", expect.objectContaining({ cache: "no-store", credentials: "same-origin", redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it.each([
    [200, "other-actor", tenantA],
    [403, "actor-a", { ok: false }],
    [503, "actor-a", { ok: false }],
    [200, "actor-a", { kind: "draft" }],
  ])("refuses status %s, actor %s, and malformed results", async (status, actor, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "x-wf-branding-actor": actor } })));
    await expect(readRuntimeBranding("actor-a")).rejects.toThrow();
  });

  it("makes the product hook use GET without an injected reader", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(updated), { headers: { "x-wf-branding-actor": "actor-a" } })));
    const { result } = renderHook(() => useRuntimeBranding(tenantA, "actor-a:tenant-a", true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.branding?.name).toBe("Updated A");
  });
});

describe("portal scope propagation", () => {
  function dialog() {
    return createPortal(<TenantBrandingScope><><div data-testid="existing-dialog-root" className="existing-dialog" style={{ top: 10 }}>
      <input aria-label="Dialog unsaved edit" defaultValue="Keep this" />
    </div><button>Existing sibling</button></></TenantBrandingScope>, document.body);
  }

  it("themes existing body portal roots without wrappers or a body mutation, preserving DOM/focus/state", () => {
    const view = render(<TenantBrandingProvider value={{ branding: tenantBranding(tenantA), unavailable: false }}>{dialog()}</TenantBrandingProvider>);
    const root = screen.getByTestId("existing-dialog-root");
    const input = screen.getByLabelText("Dialog unsaved edit") as HTMLInputElement;
    expect(root.parentElement).toBe(document.body);
    expect(root).toHaveAttribute("data-branding-tenant", tenantA.configuration.tenantId);
    expect(root.style.top).toBe("10px");
    expect(root.style.getPropertyValue("--tenant-primary")).toBe("#173c32");
    input.value = "Still unsaved";
    input.focus();
    view.rerender(<TenantBrandingProvider value={{ branding: tenantBranding(tenantB), unavailable: false }}>{dialog()}</TenantBrandingProvider>);
    expect(screen.getByTestId("existing-dialog-root")).toBe(root);
    expect(input).toHaveFocus();
    expect(input.value).toBe("Still unsaved");
    view.rerender(<TenantBrandingProvider value={{ branding: null, unavailable: true }}>{dialog()}</TenantBrandingProvider>);
    expect(screen.getByTestId("existing-dialog-root")).toBe(root);
    expect(root).not.toHaveAttribute("data-branding-tenant");
    expect(root.style.getPropertyValue("--tenant-primary")).toBe("");
    expect(input).toHaveFocus();
    expect(input.value).toBe("Still unsaved");
    expect(document.body.style.getPropertyValue("--tenant-primary")).toBe("");
  });

  it("keeps existing portal roots unchanged without a provider", () => {
    render(dialog());
    const root = screen.getByTestId("existing-dialog-root");
    expect(root.className).toBe("existing-dialog");
    expect(root).not.toHaveAttribute("data-branding-tenant");
    expect(root.parentElement).toBe(document.body);
  });
});
