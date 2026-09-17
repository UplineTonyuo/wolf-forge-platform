/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useHeaderOverlay } from "../components/shell/use-header-overlay";

/**
 * Notifications, Chat, Quick Action and Account each call this hook with
 * their own id. It is the single mechanism keeping at most one of those
 * mobile header surfaces open at a time (Section J).
 */
afterEach(() => vi.restoreAllMocks());

it("tells every other mounted surface to close when one opens, and never itself", () => {
  const closeA = vi.fn();
  const closeB = vi.fn();
  const closeC = vi.fn();

  const a = renderHook(({ open }) => useHeaderOverlay("notifications", open, closeA), {
    initialProps: { open: false },
  });
  const b = renderHook(({ open }) => useHeaderOverlay("chat", open, closeB), {
    initialProps: { open: false },
  });
  const c = renderHook(({ open }) => useHeaderOverlay("quick-action", open, closeC), {
    initialProps: { open: false },
  });

  act(() => a.rerender({ open: true }));
  expect(closeA).not.toHaveBeenCalled();
  expect(closeB).toHaveBeenCalledTimes(1);
  expect(closeC).toHaveBeenCalledTimes(1);

  act(() => b.rerender({ open: true }));
  expect(closeA).toHaveBeenCalledTimes(1);
  expect(closeB).toHaveBeenCalledTimes(1);
  expect(closeC).toHaveBeenCalledTimes(2);

  act(() => c.rerender({ open: true }));
  expect(closeA).toHaveBeenCalledTimes(2);
  expect(closeB).toHaveBeenCalledTimes(2);
  expect(closeC).toHaveBeenCalledTimes(2);
});

it("does not react to its own id announcing again", () => {
  const close = vi.fn();
  const { rerender } = renderHook(({ open }) => useHeaderOverlay("profile", open, close), {
    initialProps: { open: false },
  });

  act(() => rerender({ open: true }));
  act(() => rerender({ open: false }));
  act(() => rerender({ open: true }));

  expect(close).not.toHaveBeenCalled();
});
