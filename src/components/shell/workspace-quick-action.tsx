"use client";

import {
  ArrowRight,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useState,
} from "react";
import {
  createPortal,
} from "react-dom";
import type {
  InternalUser,
} from "../../lib/supabase/next-server";
import styles from "./workspace-quick-action.module.css";

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
  const [mounted, setMounted] =
    useState(false);

  const [open, setOpen] =
    useState(false);

  const authorized =
    user.role === "owner" ||
    user.role === "admin";

  const firstName =
    getFirstName(user.displayName);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  if (!authorized) {
    return null;
  }

  const openMenu = () => {
    window.dispatchEvent(
      new CustomEvent(
        "wf:quick-action-open",
      ),
    );

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
        onClick={() =>
          setOpen(false)
        }
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
            onClick={() =>
              setOpen(false)
            }
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div
          className={styles.options}
        >
          <Link
            href="/accounts/member/new"
            className={styles.option}
            onClick={() =>
              setOpen(false)
            }
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