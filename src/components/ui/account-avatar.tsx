"use client";

/*
 * A fixed-size avatar gains nothing from the Next image optimizer and would put
 * every 32px request through it, so a plain image element is deliberate here.
 * This matches the existing decision in
 * components/tickets/ticket-message-avatar.tsx.
 */
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { PersonSilhouette } from "./person-silhouette";
import styles from "./account-avatar.module.css";

/**
 * Only http(s) and root-relative sources are rendered.
 *
 * The value comes from public.profiles and is written by a single RPC, so this
 * is defence in depth rather than the primary control — but it costs nothing and
 * means a malformed or `javascript:` value can never reach an attribute.
 */
function safeAvatarSource(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

/**
 * The single avatar renderer for the product.
 *
 * Resolution is always: stored photo, otherwise the neutral person silhouette.
 * A photo that fails to load falls back the same way rather than showing a
 * broken-image glyph, so a deleted or unreachable object degrades quietly.
 *
 * The default fallback is one calm person silhouette. Surfaces that explicitly
 * need another established identity treatment may provide `fallback`.
 *
 * The image is decorative wherever the account name is already rendered beside
 * it, which is the case on every current surface — hence the empty alt by
 * default. Pass `alt` explicitly where the avatar stands alone.
 */
export function AccountAvatar({
  avatarUrl,
  size = 36,
  shape = "circle",
  onNavy = false,
  alt = "",
  className,
  fallback,
}: {
  /**
   * Kept on the contract because every call site already has it and the
   * component is the natural owner of any future name-derived treatment. The
   * silhouette fallback is identical for everyone, so nothing reads it today.
   */
  name?: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  shape?: "circle" | "rounded";
  /** Use the inverted treatment on navy surfaces such as the sidebar rail. */
  onNavy?: boolean;
  alt?: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const source = useMemo(() => safeAvatarSource(avatarUrl), [avatarUrl]);

  /*
   * Remembering *which* url failed rather than a boolean means a newly saved
   * photo is retried automatically, with no effect needed to reset the flag.
   */
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = source !== null && source !== failedSource;

  const style = {
    "--wf-avatar-size": `${size}px`,
  } as CSSProperties;

  return (
    <span
      className={[
        styles.root,
        shape === "circle" ? styles.circle : styles.rounded,
        onNavy ? styles.onNavy : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {showImage ? (
        <img
          className={styles.image}
          src={source}
          alt={alt}
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(source)}
        />
      ) : (
        fallback ?? <PersonSilhouette className={styles.fallback} />
      )}
    </span>
  );
}
