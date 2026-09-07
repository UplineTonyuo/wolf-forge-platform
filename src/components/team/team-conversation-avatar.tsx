"use client";

import { UsersRound } from "lucide-react";
import { useState } from "react";
import styles from "./team-messages.module.css";

/** Group portrait with the existing people-mark fallback when no image is available. */
export function TeamConversationAvatar({
  imageUrl,
  small = false,
  className,
}: {
  imageUrl?: string | null;
  small?: boolean;
  className?: string;
}) {
  const normalizedUrl = imageUrl?.trim() || null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = normalizedUrl !== null && normalizedUrl !== failedUrl;

  return (
    <span
      className={[
        styles.groupAvatar,
        small ? styles.groupAvatarSmall : "",
        className,
      ].filter(Boolean).join(" ")}
      aria-hidden="true"
      data-team-group-avatar={showImage ? "custom" : "fallback"}
    >
      {showImage ? (
        // Small Supabase-hosted conversation images do not benefit from a Next optimizer round trip.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={normalizedUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(normalizedUrl)}
        />
      ) : (
        <UsersRound />
      )}
    </span>
  );
}
