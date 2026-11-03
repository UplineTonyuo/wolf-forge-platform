const locks = new WeakMap<HTMLElement, { count: number; originallyInert: boolean }>();

/** Overlapping call/lightbox lifetimes must restore a sibling only after its last owner leaves. */
export function lockModalSiblings(root: HTMLElement) {
  const held = new Set<HTMLElement>();
  const acquire = () => {
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement) || child.contains(root) || held.has(child)) continue;
      if (child.matches('.portal-overlay[data-layer="call"]') && !root.closest('.portal-overlay[data-layer="call"]')) continue;
      const lock = locks.get(child) ?? { count: 0, originallyInert: child.hasAttribute("inert") };
      lock.count++; locks.set(child, lock); held.add(child); child.setAttribute("inert", "");
    }
  };
  acquire();
  const observer = new MutationObserver(acquire);
  observer.observe(document.body, { childList: true });
  return () => {
    observer.disconnect();
    for (const child of held) {
      const lock = locks.get(child);
      if (!lock || --lock.count > 0) continue;
      if (!lock.originallyInert) child.removeAttribute("inert");
      locks.delete(child);
    }
    held.clear();
  };
}
