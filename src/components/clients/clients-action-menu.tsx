"use client";

import {
  ArrowRight,
  Building2,
  Plus,
  UserRoundPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createPortal,
} from "react-dom";
import styles from "./clients-action-menu.module.css";

function getFirstName(
  displayName: string | null | undefined,
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

export function ClientsActionMenu({
  displayName,
}: {
  displayName?: string | null;
}) {
  const mounted =
    useSyncExternalStore(
      () => () => {},
      () => true,
      () => false,
    );

  const [open, setOpen] =
    useState(false);

  const firstName =
    getFirstName(displayName);

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
        aria-label="Close client actions"
        tabIndex={open ? 0 : -1}
        onClick={() =>
          setOpen(false)
        }
      />

      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clients-create-title"
      >
        <header
          className={styles.header}
        >
          <div>
            <span
              className={styles.eyebrow}
            >
              CLIENTS
            </span>

            <h2 id="clients-create-title">
              Add
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
            href="/accounts/client/new"
            className={styles.option}
            onClick={() =>
              setOpen(false)
            }
          >
            <span
              className={`${styles.optionIcon} ${styles.clientIcon}`}
            >
              <UserRoundPlus
                aria-hidden="true"
              />
            </span>

            <span
              className={styles.optionCopy}
            >
              <strong>
                Add Client
              </strong>

              <span>
                Create a client account with portal access and connect it to a company.
              </span>
            </span>

            <ArrowRight
              className={styles.arrow}
              aria-hidden="true"
            />
          </Link>

          <Link
            href="/companies/new"
            className={styles.option}
            onClick={() =>
              setOpen(false)
            }
          >
            <span
              className={`${styles.optionIcon} ${styles.companyIcon}`}
            >
              <Building2
                aria-hidden="true"
              />
            </span>

            <span
              className={styles.optionCopy}
            >
              <strong>
                Add Company
              </strong>

              <span>
                Create a company record without creating a login.
              </span>
            </span>

            <ArrowRight
              className={styles.arrow}
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
        className={styles.trigger}
        type="button"
        aria-label="Add client or company"
        title="Add client or company"
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
