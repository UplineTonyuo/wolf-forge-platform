"use client";

import { ChevronDown, LoaderCircle, LogOut } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { signOutAction } from "../../app/actions/auth";
import type { InternalUser } from "../../lib/supabase/next-server";
import { AccountAvatar } from "../ui/account-avatar";
import { useHeaderOverlay } from "./use-header-overlay";
import { PwaInstallButton } from "../pwa/pwa-provider";
import styles from "./account-menu.module.css";

function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" role="menuitem" aria-busy={pending || undefined} disabled={pending}>
      {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
      <span>Sign out</span>
    </button>
  );
}

/**
 * How long the menu's closing transition runs, in milliseconds. Must stay in
 * step with the closed-state `transition-duration` in globals.css: it is the
 * window the menu is held in the DOM so the exit is visible.
 */
const MENU_EXIT_MS = 110;

/** `closing` is the menu animating out — mounted, but no longer interactive. */
type MenuPhase = "closed" | "open" | "closing";

export function AccountMenu({ user, mobile = false, sidebar = false }: { user: InternalUser; mobile?: boolean; sidebar?: boolean }) {
  const [phase, setPhase] = useState<MenuPhase>("closed");
  const exitTimerRef = useRef<number | null>(null);
  const open = phase === "open";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* The sidebar and the command bar each render one of these, so ids collide. */
  const identityId = useId();

  /*
   * Closing hands the menu to CSS and keeps it mounted for the length of the
   * exit. Reopening before that lands cancels the timer, so the menu retargets
   * from wherever it currently sits instead of restarting.
   */
  const close = useCallback(() => {
    setPhase((current) => (current === "open" ? "closing" : current));

    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);

    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      setPhase((current) => (current === "closing" ? "closed" : current));
    }, MENU_EXIT_MS);
  }, []);

  const openMenu = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    setPhase("open");
  }, []);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };

    /*
     * Dismiss on any press outside the trigger and the menu. Without this the
     * menu stayed open until Escape, which is unreachable with a pointer.
     */
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };

    /* Tabbing past the last item closes the menu rather than stranding it open. */
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [close, open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  /*
   * The sidebar rail and the command bar each mount one of these; only the
   * command bar instance needs to close when another header surface (Chat,
   * Notifications, Quick Action) opens, so the sidebar one gets its own id
   * and never actually coordinates with anything.
   */
  useHeaderOverlay(sidebar ? "profile-sidebar" : "profile", open, close);

  const roleLabel = `${user.role[0]?.toUpperCase() ?? ""}${user.role.slice(1)}`;

  return (
    <div className={sidebar ? "account account-sidebar" : mobile ? "account account-mobile" : "account account-desktop"}>
      <button
        ref={buttonRef}
        type="button"
        className="avatar-button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
      >
        {/*
          One canonical avatar renderer: the stored photo when the account has
          one, initials otherwise. The rail sits on navy, the command bar on
          white, so only the treatment differs.
        */}
        <AccountAvatar
          name={user.displayName}
          avatarUrl={user.avatarUrl}
          size={sidebar ? 32 : 30}
          onNavy={sidebar}
        />
        {sidebar ? <><span className="account-button-copy"><strong>{user.displayName ?? "Unnamed user"}</strong><small>{user.role}</small></span><ChevronDown aria-hidden="true" /></> : null}
      </button>
      {phase !== "closed" ? (
        <div
          ref={menuRef}
          className={sidebar ? "account-popover account-popover-sidebar" : mobile ? "account-sheet" : "account-popover"}
          data-state={open ? "open" : "closed"}
        >
          {/*
            The identity block is a heading for the menu, not an item in it, so
            the menu role wraps only what is actually actionable.
          */}
          <div className="account-identity" id={identityId}>
            <strong>{user.displayName ?? "Unnamed user"}</strong>
            <span>{roleLabel}</span>
          </div>
          <div className={styles.actions} role="menu" aria-labelledby={identityId}>
            <PwaInstallButton variant="menu" focusReturnRef={buttonRef} />
            <form action={signOutAction} role="none">
              <SignOutButton />
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
