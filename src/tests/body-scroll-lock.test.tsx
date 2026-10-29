// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useBodyScrollLock } from "../components/ui/use-body-scroll-lock";
afterEach(() => { cleanup(); document.body.style.overflow = ""; });
it("keeps scrolling locked when an older overlay finishes closing after a new overlay opens", () => {
  document.body.style.overflow = "auto";
  const inbox = renderHook(({ open }) => useBodyScrollLock(open), { initialProps: { open: true } });
  const next = renderHook(({ open }) => useBodyScrollLock(open), { initialProps: { open: true } });
  inbox.rerender({ open: false });
  expect(document.body.style.overflow).toBe("hidden");
  next.rerender({ open: false });
  expect(document.body.style.overflow).toBe("auto");
});
it("repeated and nested locks restore the original style without adding padding or scrolling", () => {
  document.body.style.paddingRight = "7px";
  const first = renderHook(({ open }) => useBodyScrollLock(open), { initialProps: { open: false } });
  for (let n = 0; n < 3; n++) {
    first.rerender({ open: true });
    const child = renderHook(() => useBodyScrollLock(true));
    child.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    first.rerender({ open: false });
    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.paddingRight).toBe("7px");
  }
  document.body.style.paddingRight = "";
});
