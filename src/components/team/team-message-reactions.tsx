"use client";

import { Ellipsis, Reply, SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  teamPickerReactionCodes,
  teamReactionEmoji,
  type TeamReactionCode,
} from "../../domain/team/schema";
import type { TeamReactionView } from "../../domain/team/projections";
import styles from "./team-messages.module.css";

const teamReactionLabels: Record<TeamReactionCode, string> = {
  like: "Like",
  heart: "Heart",
  laugh: "Laugh",
  wow: "Wow",
  celebrate: "Celebrate",
  fire: "Fire",
  eyes: "Eyes",
  pray: "Pray",
  check: "Check",
};

/**
 * The compact message-action rail: React, Reply, More. The reaction picker is
 * controlled by the conversation so opening any other message surface closes
 * this one without a global timer or a second interaction system.
 *
 * Desktop reveal is pure CSS (`.bubbleRow:hover`/`:focus-within`). Mobile has
 * no hover, so `mobileActive`
 * is a JS-controlled class the conversation pane sets when a bubble is
 * tapped, deliberately not a long-press timer — the simplest touch
 * interaction that cannot fight scrolling, text selection, or a link inside
 * the message.
 */
export function TeamReactionRail({
  reactions,
  onReact,
  mobileActive,
  onInteract,
  pickerOpen,
  onTogglePicker,
  onClosePicker,
  onReply,
  onMore,
}: {
  reactions: TeamReactionView[];
  onReact: (code: TeamReactionCode) => void;
  mobileActive: boolean;
  /** Called on any tap/click, so the mobile "selected" bubble stays selected. */
  onInteract: () => void;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onClosePicker: () => void;
  onReply: () => void;
  onMore: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;

    function outside(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClosePicker();
      }
    }
    /*
     * Capture phase, and specifically not just a bubble-phase listener: the
     * drawer has its own document-level Escape handler that closes the WHOLE
     * Team Messages surface, registered once when the drawer opens — long
     * before this picker's listener exists. Two "at document" listeners for
     * the same event fire in registration order, so the drawer's would run
     * FIRST and close everything before this handler ever saw the key.
     * Capture-phase listeners on `document` run before bubble-phase ones
     * regardless of registration order, which is what lets the picker win.
     */
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClosePicker();
    }

    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, { capture: true });
    };
  }, [onClosePicker, pickerOpen]);

  const reactedCodes = new Set(
    reactions.filter((reaction) => reaction.reactedByMe).map((reaction) => reaction.code),
  );

  return (
    <div
      ref={rootRef}
      className={[
        styles.reactionRail,
        mobileActive ? styles.reactionRailMobileActive : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="toolbar"
      aria-label="Message actions"
    >
      <button
        type="button"
        className={styles.reactionRailButton}
        aria-label="React"
        aria-haspopup="menu"
        aria-expanded={pickerOpen}
        title="React"
        onClick={() => {
          onInteract();
          onTogglePicker();
        }}
      >
        <SmilePlus aria-hidden="true" />
      </button>

      <button
        type="button"
        className={styles.reactionRailButton}
        aria-label="Reply"
        title="Reply"
        onClick={() => {
          onInteract();
          onReply();
        }}
      >
        <Reply aria-hidden="true" />
      </button>

      <button
        type="button"
        className={styles.reactionRailButton}
        aria-label="More"
        title="More"
        onClick={() => {
          onInteract();
          onMore();
        }}
      >
        <Ellipsis aria-hidden="true" />
      </button>

      {pickerOpen ? (
        <div className={styles.reactionPicker} role="menu" aria-label="Reactions">
          {teamPickerReactionCodes.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemcheckbox"
              aria-checked={reactedCodes.has(code)}
              aria-label={teamReactionLabels[code]}
              title={teamReactionLabels[code]}
              className={[
                styles.reactionPickerButton,
                reactedCodes.has(code) ? styles.reactionPickerButtonActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                onInteract();
                onClosePicker();
                onReact(code);
              }}
            >
              <span aria-hidden="true">{teamReactionEmoji[code]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The compact chip row under a bubble. Never renders a zero-count chip — the
 * view layer already drops those. Clicking a chip toggles the viewer's own
 * reaction of that type; hovering or focusing it reveals who reacted.
 */
export function TeamReactionChips({
  reactions,
  onToggle,
}: {
  reactions: TeamReactionView[];
  onToggle: (code: TeamReactionCode) => void;
}) {
  if (reactions.length === 0) return null;

  return (
    <div className={styles.reactionChips}>
      {reactions.map((reaction) => (
        <TeamReactionChip
          key={reaction.code}
          reaction={reaction}
          onToggle={() => onToggle(reaction.code)}
        />
      ))}
    </div>
  );
}

function TeamReactionChip({
  reaction,
  onToggle,
}: {
  reaction: TeamReactionView;
  onToggle: () => void;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const shown = reaction.reactorNames.slice(0, 8);
  const overflow = reaction.reactorNames.length - shown.length;

  return (
    <span className={styles.reactionChipWrap}>
      <button
        type="button"
        className={[
          styles.reactionChip,
          reaction.reactedByMe ? styles.reactionChipActive : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-pressed={reaction.reactedByMe}
        aria-label={`${teamReactionLabels[reaction.code]}, ${reaction.count}${
          reaction.reactedByMe ? ", reacted by you" : ""
        }`}
        onClick={onToggle}
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        onFocus={() => setTooltipOpen(true)}
        onBlur={() => setTooltipOpen(false)}
      >
        <span aria-hidden="true">{reaction.emoji}</span>
        <span>{reaction.count}</span>
      </button>

      {tooltipOpen ? (
        <span className={styles.reactionTooltip} role="tooltip">
          {shown.join(", ")}
          {overflow > 0 ? ` +${overflow}` : ""}
        </span>
      ) : null}
    </span>
  );
}
