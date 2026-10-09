"use client";

import {
  ArrowRight,
  BarChart3,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createPortal,
} from "react-dom";
import type {
  InternalUser,
} from "../../lib/supabase/next-server";
import { useHeaderOverlay } from "./use-header-overlay";
import styles from "./workspace-quick-action.module.css";

/**
 * Which face of the panel is showing.
 *
 * One face, for now. Phase 1 sent a report from inside this panel; Phase 2
 * moved that to the real Reporting builder, so "Send Reporting" is a link out
 * rather than a form in here. The keyed wrapper below is kept because the next
 * quick action that genuinely belongs in a panel will need it.
 */
type QuickView = "menu";

function getFirstName(
  displayName: string | null,
) {
  const clean =
    displayName?.trim();

  if (!clean) {
    return null;
  }

  return (
    clean.split(/\s+/u)[0] ??
    null
  );
}

export function WorkspaceQuickAction({
  user,
}: {
  user: InternalUser;
}) {
  const [view, setView] =
    useState<QuickView>("menu");

  /*
   * Which way the next face arrives from. Set alongside every view change, so
   * entering the form slides forward and cancelling slides back.
   */
  const [direction, setDirection] =
    useState<"forward" | "back">("forward");

  const mounted =
    useSyncExternalStore(
      () => () => {},
      () => true,
      () => false,
    );

  const [open, setOpen] =
    useState(false);

  /*
   * The face that just arrived. Switching views removes the control that was
   * focused, which would otherwise drop focus to the body and strand a keyboard
   * user outside the dialog.
   */
  const viewRef =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only after a deliberate switch; opening the panel leaves focus alone.
    if (!open || view === "menu") return;
    viewRef.current?.focus();
  }, [open, view]);

  const authorized =
    user.role === "owner" ||
    user.role === "admin";

  const firstName =
    getFirstName(user.displayName);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    const onKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === "Escape") {
        setOpen(false);
        setView("menu");
        setDirection("forward");
      }
    };

    document.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      document.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [open]);

  /* Closing always resets the face, so nothing half-filled waits behind the next open. */
  const closePanel = () => {
    setOpen(false);
    setView("menu");
    setDirection("forward");
  };

  useHeaderOverlay("quick-action", open, closePanel);

  if (!authorized) {
    return null;
  }

  const openMenu = () => {
    setView("menu");
    setDirection("forward");
    setOpen(true);
  };

  const modal = (
    <div
      className={`${styles.modal} ${
        open ? styles.open : ""
      }`}
      aria-hidden={!open}
    >
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Close quick action"
        tabIndex={open ? 0 : -1}
        onClick={closePanel}
      />

      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-quick-title"
      >
        <header
          className={styles.header}
        >
          <div>
            <span
              className={styles.eyebrow}
            >
              QUICK ACTION
            </span>

            <h2 id="global-quick-title">
              Wolf Forge
            </h2>

            <p>
              {firstName
                ? `What do you want to create, ${firstName}?`
                : "What do you want to create?"}
            </p>
          </div>

          <button
            className={styles.close}
            type="button"
            aria-label="Close"
            onClick={closePanel}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {/*
          * One face at a time inside the same panel. Keyed on the view so React
          * remounts it and the entrance replays; no second dialog is created,
          * so focus stays inside the one modal throughout.
          */}
        <div
          key={view}
          ref={viewRef}
          className={styles.view}
          tabIndex={-1}
          data-direction={direction === "back" ? "back" : undefined}
        >
        <div
          className={styles.options}
        >
          {/*
            * Phase 2: this opens the real Reporting builder instead of a second,
            * simpler sender inside the panel. Quick Action still starts the job
            * in one click; the job is now a structured report rather than a
            * bare link.
            */}
          {user.modules.reporting && <Link
            href="/reporting/new"
            className={styles.option}
            onClick={closePanel}
          >
            <span
              className={
                styles.optionIcon
              }
            >
              <BarChart3
                aria-hidden="true"
              />
            </span>

            <span
              className={
                styles.optionCopy
              }
            >
              <strong>
                Send Reporting
              </strong>

              <span>
                Build and send an SEO package or GMB Management report.
              </span>
            </span>

            <ArrowRight
              className={
                styles.arrow
              }
              aria-hidden="true"
            />
          </Link>}

          <Link
            href="/accounts/member/new"
            className={styles.option}
            onClick={closePanel}
          >
            <span
              className={
                styles.optionIcon
              }
            >
              <ShieldCheck
                aria-hidden="true"
              />
            </span>

            <span
              className={
                styles.optionCopy
              }
            >
              <strong>
                Add Wolf Forge Member
              </strong>

              <span>
                Create an internal Wolf Forge team account.
              </span>
            </span>

            <ArrowRight
              className={
                styles.arrow
              }
              aria-hidden="true"
            />
          </Link>
        </div>
        </div>
      </section>
    </div>
  );

  return (
    <>
      <button
        className="workspace-command-button workspace-command-plus"
        type="button"
        aria-label="Quick Action"
        title="Quick Action"
        aria-expanded={open}
        onClick={openMenu}
      >
        <Plus aria-hidden="true" />
      </button>

      {mounted
        ? createPortal(
            modal,
            document.body,
          )
        : null}
    </>
  );
}
