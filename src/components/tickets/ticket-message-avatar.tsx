"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import { PersonSilhouette } from "../ui/person-silhouette";
import { projectInitials } from "../../domain/orders/projections";
import styles from "./tickets.module.css";

function safeAvatarSource(
  value: string | null | undefined,
): string | null {
  const candidate = value?.trim();

  if (!candidate) {
    return null;
  }

  if (
    candidate.startsWith("/") &&
    !candidate.startsWith("//")
  ) {
    return candidate;
  }

  try {
    const parsed = new URL(candidate);

    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    ) {
      return candidate;
    }
  } catch {
    return null;
  }

  return null;
}

export function TicketMessageAvatar({
  src,
  name,
}: {
  src?: string | null;
  /**
   * Real display name to derive initials from when there is no stored
   * avatar. Omit to keep the generic person-silhouette fallback (used where
   * no reliable display name is guaranteed, e.g. internal notes).
   */
  name?: string;
}) {
  const safeSource =
    useMemo(
      () => safeAvatarSource(src),
      [src],
    );

  const [failed, setFailed] =
    useState(false);

  if (
    safeSource &&
    !failed
  ) {
    return (
      <span
        className={styles.messageAvatar}
        aria-hidden="true"
      >
        <img
          src={safeSource}
          alt=""
          referrerPolicy="no-referrer"
          onError={() =>
            setFailed(true)
          }
          data-testid="ticket-avatar-image"
        />
      </span>
    );
  }

  return (
    <span
      className={`${styles.messageAvatar} ${styles.messageAvatarFallback}`}
      aria-hidden="true"
      data-testid="ticket-avatar-fallback"
    >
      {name ? (
        projectInitials(name)
      ) : (
        <>
          {/*
            * A person, not the Wolf Forge mark. A message author is a human,
            * and the brand in that slot read as though Wolf Forge itself had
            * written the message rather than a member of the team.
            */}
          <PersonSilhouette />
        </>
      )}
    </span>
  );
}