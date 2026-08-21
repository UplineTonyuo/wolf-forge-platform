"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./reporting.module.css";

/**
 * After a face has been visible for its display duration, return to the
 * Reporting list by clicking a hidden <Link>.
 *
 * A Link rather than a captured router.push on purpose: the send action calls
 * revalidatePath, which makes Next refresh the current route once the action
 * finishes. The refresh can leave a router instance captured earlier unable
 * to navigate; a Link's click handler always resolves the current router at
 * render time, so the click navigates even across that refresh. The hidden
 * link lives beside the face, so the completion host (which keeps the editor
 * mounted through the refresh) keeps this timer alive too.
 */
function useReportingReturn(open: boolean, delayMs: number) {
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => linkRef.current?.click(), delayMs);
    return () => clearTimeout(timer);
  }, [open, delayMs]);
  return linkRef;
}

/**
 * The two transient completion faces of the report flow: the "Draft saved"
 * confirmation after a successful save, and the "Report delivered" outro
 * after a successful send.
 *
 * Both render through createPortal(…, document.body) so no page wrapper,
 * transform, or scroll position can contain them (D-055 — an overlay rendered
 * inline resolves its `position: fixed` against the nearest transformed
 * ancestor, which is exactly the bug these faces exist to avoid).
 *
 * Both lock body scroll while visible and are presentation only: the caller
 * owns the timer that navigates back to /reporting. Reduced-motion handling
 * lives in reporting.module.css, matching the project's CSS-only motion rule.
 */

export function ReportSaveNotice({ open }: { open: boolean }) {
  const returnRef = useReportingReturn(open, 850);
  // See the scroll-lock note on ReportSendOutro below — same rule.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.saveNoticeBackdrop} role="status">
      <div className={styles.saveNotice}>
        <span className={styles.saveNoticeMark} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M20 6 9 17l-5-5"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
            />
          </svg>
        </span>
        <h2>Draft saved</h2>
        <p>Your report is ready to continue later.</p>
      </div>
      <Link ref={returnRef} href="/reporting" tabIndex={-1} aria-hidden="true" style={{ display: "none" }}>
        Open reporting list
      </Link>
    </div>,
    document.body,
  );
}

export function ReportSendOutro({ open, companyName }: { open: boolean; companyName: string }) {
  const returnRef = useReportingReturn(open, 1500);
  /*
   * Scroll lock restores to "" on purpose, never to a captured "previous".
   * The outro mounts in the same commit the send confirmation starts its exit
   * animation, while the body is still legitimately locked by that dialog —
   * capturing that value would leave the /reporting list scroll-locked when
   * the outro unmounts on navigation. The only scroll-lock owners in the app
   * are PortalDialog (which restores its own) and these faces, so "" is the
   * honest terminal state.
   */
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.sendOutroBackdrop} role="status">
      <div className={styles.sendOutro}>
        <span className={styles.sendOutroMark} aria-hidden="true">
          {/* The same deliberate <img> as WolfForgeMark: the branding mark is a
              pre-sized PNG, not an optimized Next image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/wolf-head-mark.png"
            alt=""
            width={1920}
            height={1080}
            className={styles.sendOutroWolf}
          />
          <span className={styles.sendOutroCheck}>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6 9 17l-5-5"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
              />
            </svg>
          </span>
        </span>
        <h2>Report delivered to client</h2>
        <p>{companyName} can now view the report in their Wolf Forge portal.</p>
        <span className={styles.sendOutroSweep} aria-hidden="true" />
        <em>Returning to Reporting…</em>
      </div>
      <Link ref={returnRef} href="/reporting" tabIndex={-1} aria-hidden="true" style={{ display: "none" }}>
        Open reporting list
      </Link>
    </div>,
    document.body,
  );
}
