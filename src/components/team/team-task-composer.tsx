"use client";

import { AlertCircle, Loader2, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  TeamMemberView,
  TeamMessageView,
} from "../../domain/team/projections";
import {
  teamTaskDescriptionMaxLength,
  teamTaskPriorities,
  teamTaskPriorityLabels,
  teamTaskTitleMaxLength,
  type TeamTaskPriority,
} from "../../domain/team/schema";
import { stripTeamFormatting } from "../../domain/team/formatting";
import { useClientMounted, useExitTransition } from "./use-exit-transition";
import { DatePicker } from "../ui/date-picker";
import styles from "./team-messages.module.css";

const priorityAccent: Record<TeamTaskPriority, string> = {
  low: "#c3c8d4",
  normal: "#6f7ea8",
  high: "#a8832e",
  urgent: "#8c2f2f",
};

export type TeamTaskDraft = {
  title: string;
  description: string | null;
  assignedToProfileId: string;
  priority: TeamTaskPriority;
  dueAt: string | null;
  sourceMessageId: string | null;
};

/**
 * Create Task.
 *
 * Reached two ways, and the difference is only what it opens knowing: from the
 * composer it starts blank, and from a message it starts with that message
 * quoted and its id carried as `sourceMessageId`, which is what later lets a
 * task card navigate back to the line that caused it.
 *
 * Assignment is limited to the two people in the conversation, matching
 * app_create_team_task — assigning a task never widens who can read the thread.
 *
 * The caller mounts this fresh for each open (a changing `key`), so every field
 * starts from a `useState` initializer rather than being reset by an effect.
 * A stale title carried over from the previous open is a quiet way to create
 * the wrong task twice.
 */
export function TeamTaskComposer({
  open,
  onClose,
  onSubmit,
  members,
  defaultAssigneeId,
  sourceMessage,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: TeamTaskDraft) => void;
  /** Both conversation members: the actor and the colleague. */
  members: TeamMemberView[];
  defaultAssigneeId: string;
  sourceMessage: TeamMessageView | null;
  submitting: boolean;
  error: string | null;
}) {
  const mounted = useClientMounted();
  const { render, phase } = useExitTransition(open, 180);

  const [title, setTitle] = useState(() =>
    sourceMessage
      ? stripTeamFormatting(sourceMessage.body).slice(0, teamTaskTitleMaxLength).trim()
      : "",
  );
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(defaultAssigneeId);
  const [priority, setPriority] = useState<TeamTaskPriority>("normal");
  const [dueDate, setDueDate] = useState("");

  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!render || phase !== "open") return;
    const timer = window.setTimeout(() => titleRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [phase, render]);

  /* Escape closes, and Tab is trapped, because this sits above the drawer. */
  useEffect(() => {
    if (!render) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, render]);

  if (!mounted || !render) return null;

  const closing = phase === "closing";
  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: trimmedTitle,
      description: description.trim() || null,
      assignedToProfileId: assignee,
      priority,
      /*
       * A date input yields a bare calendar day. It is sent as the end of that
       * day in the viewer's own zone, so "due Friday" means all of Friday
       * rather than the instant it began.
       */
      dueAt: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : null,
      sourceMessageId: sourceMessage?.id ?? null,
    });
  };

  return createPortal(
    <div
      className={[
        styles.dialogBackdrop,
        closing ? styles.dialogBackdropClosing : styles.dialogBackdropOpen,
      ].join(" ")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-heading`}
        className={[
          styles.dialog,
          closing ? styles.dialogClosing : styles.dialogOpen,
        ].join(" ")}
      >
        <div className={styles.dialogHeader}>
          <h3 id={`${fieldId}-heading`}>Create task</h3>
          <p>
            {sourceMessage
              ? "Raised from a message. The task keeps a link back to it."
              : "A real task in this conversation, assigned to one of you."}
          </p>
        </div>

        {sourceMessage ? (
          <blockquote className={styles.sourceQuote}>
            <strong>
              {sourceMessage.isMine
                ? "You wrote"
                : `${sourceMessage.authorName} wrote`}
            </strong>
            <span>{stripTeamFormatting(sourceMessage.body)}</span>
          </blockquote>
        ) : null}

        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor={`${fieldId}-title`}>Title</label>
            <input
              ref={titleRef}
              id={`${fieldId}-title`}
              type="text"
              value={title}
              maxLength={teamTaskTitleMaxLength}
              placeholder="What needs to happen?"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={`${fieldId}-description`}>Detail (optional)</label>
            <textarea
              id={`${fieldId}-description`}
              value={description}
              maxLength={teamTaskDescriptionMaxLength}
              placeholder="Anything the assignee needs to know."
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={`${fieldId}-assignee`}>Assign to</label>
            <select
              id={`${fieldId}-assignee`}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              {members.map((member) => (
                <option key={member.profileId} value={member.profileId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <span id={`${fieldId}-priority-label`}>Priority</span>
            <div
              className={styles.priorityRow}
              role="radiogroup"
              aria-labelledby={`${fieldId}-priority-label`}
            >
              {teamTaskPriorities.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={priority === value}
                  className={[
                    styles.priorityOption,
                    priority === value ? styles.priorityOptionSelected : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ ["--task-accent" as string]: priorityAccent[value] }}
                  onClick={() => setPriority(value)}
                >
                  {teamTaskPriorityLabels[value]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span>Due date (optional)</span>
            <DatePicker
              name="team_task_due_date"
              label="Due date"
              value={dueDate}
              onChange={setDueDate}
              placeholder="No due date"
              menuLabel="Choose task due date"
              placement="above"
              shortcuts
              clearable
            />
            <span className={styles.fieldHint}>
              Due at the end of the selected day.
            </span>
          </div>
        </div>

        {error ? (
          <div
            className={styles.inlineError}
            role="alert"
            style={{ margin: "14px 0 0" }}
          >
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canSubmit}
            onClick={submit}
          >
            {submitting ? (
              <Loader2 aria-hidden="true" className={styles.spin} />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {submitting ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
