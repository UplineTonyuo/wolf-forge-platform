"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "../team/use-exit-transition";

export type DepartmentInspectorSection = {
  /** Omitted for a tab's primary field block — the tab label already names it; only supplementary blocks (e.g. "Notes") need their own heading. */
  title?: string;
  /** Plain label/value pairs — omitted values are dropped rather than shown empty, so a section can legitimately shrink to nothing. */
  fields?: readonly { label: string; value: ReactNode }[];
  /** Custom content for a section that isn't a plain field list (e.g. resource links). Used instead of `fields`. */
  content?: ReactNode;
};

export type DepartmentInspectorTab = {
  id: string;
  label: string;
  sections: readonly DepartmentInspectorSection[];
};

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The shared right-side record inspector — an operational record grouped by
 * meaning, not a raw dump of source columns, organized into restrained tabs
 * so a long field list doesn't read as one undifferentiated stack.
 *
 * Mount/unmount uses `useExitTransition` (boolean-prop-driven, unlike the
 * imperative `useAnimatedPopover`): the panel and backdrop stay rendered
 * through the closing transition rather than disappearing the instant `open`
 * goes false. The last-open content is cached via the same render-phase
 * state adjustment `useExitTransition` itself uses (a direct `setState` call
 * in the render body, guarded so it only fires when the cached value is
 * actually stale) — not an effect, which this project's lint rules reject
 * for a synchronous `setState`, and not a ref write, which they also reject
 * during render.
 *
 * Full focus management: focus moves to the close control on open, Tab
 * cycles within the panel (a real trap, not just an initial focus), Escape
 * closes, and focus returns to whatever triggered the open — typically the
 * table row — the instant a close is requested, independent of the exit
 * animation. `onClose` is read through a ref (kept current via an effect,
 * never written during render) rather than as an effect dependency, so an
 * ordinary realtime re-render (a new `onClose` closure from the parent, same
 * open record) never re-steals focus back to the close button.
 */
export function DepartmentRecordInspector({
  open,
  header,
  tabs,
  onClose,
}: {
  open: boolean;
  header: ReactNode;
  tabs: readonly DepartmentInspectorTab[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const { render, phase } = useExitTransition(open, 200);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Cache the last-open content and tab selection so the panel keeps
  // rendering the record it had while it animates closed, instead of going
  // blank the instant a vanished row (or an explicit close) flips `open` to
  // false. Each `if` below is a render-phase state adjustment — React's
  // documented way to derive state from a changing prop — not an effect.
  const [content, setContent] = useState({ header, tabs });
  if (open && content.tabs !== tabs) setContent({ header, tabs });
  const { header: displayHeader, tabs: displayTabs } = content;

  const [wasOpen, setWasOpen] = useState(open);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(tabs[0]?.id);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && tabs[0]?.id !== activeTabId) setActiveTabId(tabs[0]?.id);
  }

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!render) return null;

  const activeTab = displayTabs.find((tab) => tab.id === activeTabId) ?? displayTabs[0];
  const phaseClass = phase === "open" ? "is-open" : "is-closing";

  return createPortal(
    <div
      className={`dept-inspector-backdrop dept-inspector-backdrop-${phaseClass}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className={`dept-inspector dept-inspector-${phaseClass}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="dept-inspector-header">
          {displayHeader}
          <button ref={closeRef} type="button" className="dept-inspector-close" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        {displayTabs.length > 1 ? (
          <div className="dept-inspector-tabs" role="tablist">
            {displayTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab?.id}
                className={
                  tab.id === activeTab?.id
                    ? "dept-inspector-tab dept-inspector-tab-active"
                    : "dept-inspector-tab"
                }
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        <div role={displayTabs.length > 1 ? "tabpanel" : undefined}>
          {(activeTab?.sections ?? []).map((section, index) => (
            <div key={section.title ?? index} className="dept-inspector-section">
              {section.title ? <h3>{section.title}</h3> : null}
              {section.content ?? (
                <div className="dept-inspector-fields">
                  {(section.fields ?? []).map((field) => (
                    <div key={field.label} className="dept-inspector-field">
                      <span>{field.label}</span>
                      <strong>{field.value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
