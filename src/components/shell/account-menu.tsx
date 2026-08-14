"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "../../app/actions/auth";
import type { InternalUser } from "../../lib/supabase/next-server";

function initials(name: string | null) {
  if (!name) return "•";
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AccountMenu({ user, mobile = false, sidebar = false }: { user: InternalUser; mobile?: boolean; sidebar?: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  return (
    <div className={sidebar ? "account account-sidebar" : mobile ? "account account-mobile" : "account account-desktop"}>
      <button ref={buttonRef} className="avatar-button" aria-label="Account" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="avatar-initials">{initials(user.displayName)}</span>
        {sidebar ? <><span className="account-button-copy"><strong>{user.displayName ?? "Unnamed user"}</strong><small>{user.role}</small></span><ChevronDown aria-hidden="true" /></> : null}
      </button>
      {open ? (
        <div ref={menuRef} className={sidebar ? "account-popover account-popover-sidebar" : mobile ? "account-sheet" : "account-popover"} role="menu">
          <div className="account-identity">
            <strong>{user.displayName ?? "Unnamed user"}</strong>
            <span>{user.role[0]?.toUpperCase()}{user.role.slice(1)}</span>
          </div>
          <form action={signOutAction}>
            <button type="submit" role="menuitem">Sign out</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
