"use client";

import styles from "./team-messages.module.css";
import type { TeamPresenceStatus } from "./team-presence-provider";

/**
 * A colleague's face, or their initials when they have not set one.
 *
 * A plain <img> rather than next/image: these are Supabase avatar URLs of
 * unknown, small dimensions rendered at a fixed 26–34px, so the optimizer would
 * add a round trip and buy nothing.
 */
export function TeamAvatar({
  name,
  initials,
  avatarUrl,
  small = false,
  presence = "unknown",
}: {
  name: string;
  initials: string;
  avatarUrl: string | null;
  small?: boolean;
  presence?: TeamPresenceStatus;
}) {
  return (
    <span
      className={[styles.avatarShell, small ? styles.avatarShellSmall : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[styles.avatar, small ? styles.avatarSmall : ""]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          initials
        )}
      </span>

      {presence !== "unknown" ? (
        <>
          <span
            className={[
              styles.presenceDot,
              presence === "online"
                ? styles.presenceDotOnline
                : styles.presenceDotOffline,
            ].join(" ")}
            aria-hidden="true"
          />
          <span className={styles.srOnly}>
            {name} is {presence}
          </span>
        </>
      ) : null}
    </span>
  );
}
