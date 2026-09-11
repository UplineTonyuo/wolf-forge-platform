"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Extracted from the Podcast SEO view unchanged (same validation, same
 * link attributes) so every future department reuses one safe-link
 * implementation instead of each re-deriving it. Source data is untrusted:
 * never rendered as HTML, and never linked unless it parses as a real
 * http(s) URL — a `javascript:`/malformed value falls back to plain,
 * unclickable text instead of becoming a link.
 */
function toSafeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function DepartmentResourceLink({
  href,
  label,
  icon,
  className,
  onClick,
  onKeyDown,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  className?: string;
  /** Lets interactive table cells stop activation from bubbling to their row. */
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Stops a key press (typically Enter/Space) from bubbling to an ancestor row's own activation handler. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLAnchorElement>) => void;
}) {
  const safeUrl = toSafeHttpUrl(href);
  if (!safeUrl) return <span className="dept-link-invalid">{label}</span>;
  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={["dept-resource-link", className].filter(Boolean).join(" ")}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {icon}
      <span>{label}</span>
      <ExternalLink aria-hidden="true" size={11} />
    </a>
  );
}
