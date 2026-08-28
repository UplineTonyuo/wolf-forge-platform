"use client";

import { Check, Clock, Loader2, ShieldCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TeamConversationDetailView, TeamMemberView } from "../../domain/team/projections";
import {
  teamConversationCapabilities,
  teamConversationCapabilityLabels,
  teamGroupTitleMaxLength,
  teamSlowModeScopeLabels,
  teamSlowModeScopes,
  teamTaskCreationPolicies,
  teamTaskCreationPolicyLabels,
  type TeamConversationCapability,
  type TeamSlowModeScope,
  type TeamTaskCreationPolicy,
} from "../../domain/team/schema";
import { useClientMounted, useExitTransition } from "./use-exit-transition";
import styles from "./team-messages.module.css";

/**
 * The clock-icon panel: Slow Mode, task creation policy, and — for a group —
 * rename, members and delegated admins.
 *
 * Every control here is a REQUEST, never a grant. `detail.capabilities` is a
 * projection of the same `private.require_team_conversation_capability` check
 * the RPC itself re-runs, so a stale or forged capability flag can make a
 * control appear that then fails server-side — it can never make a
 * disallowed mutation actually succeed.
 */
export function TeamConversationControls({
  open,
  detail,
  roster,
  onClose,
  onRename,
  onSetSlowMode,
  onSetTaskCreationPolicy,
  onGrantAdmin,
  onRevokeAdmin,
  onAddMember,
  onRemoveMember,
}: {
  open: boolean;
  detail: TeamConversationDetailView;
  /** Every active internal teammate, for the "add member" picker. */
  roster: TeamMemberView[];
  onClose: () => void;
  onRename: (title: string) => Promise<string | null>;
  onSetSlowMode: (seconds: number | null, scope: TeamSlowModeScope) => Promise<string | null>;
  onSetTaskCreationPolicy: (policy: TeamTaskCreationPolicy) => Promise<string | null>;
  onGrantAdmin: (
    targetProfileId: string,
    capabilities: Partial<Record<TeamConversationCapability, boolean>>,
  ) => Promise<string | null>;
  onRevokeAdmin: (targetProfileId: string) => Promise<string | null>;
  onAddMember: (profileId: string) => Promise<string | null>;
  onRemoveMember: (profileId: string) => Promise<string | null>;
}) {
  const mounted = useClientMounted();
  const transition = useExitTransition(open, 180);
  const cardRef = useRef<HTMLDivElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeChoice, setScopeChoice] = useState<TeamSlowModeScope>(detail.slowModeScope);
  const [titleDraft, setTitleDraft] = useState(detail.title ?? "");
  const [addMemberId, setAddMemberId] = useState("");
  const [grantTargetId, setGrantTargetId] = useState("");
  const [grantCapabilities, setGrantCapabilities] = useState<
    Partial<Record<TeamConversationCapability, boolean>>
  >({});

  /*
   * Re-synced from `detail` on every render WHILE CLOSED, so the next open
   * always starts from the latest server state rather than a stale edit left
   * over from a previous session. A render-time adjustment settles (each
   * write makes the guard false), so this is not a loop — the same idiom the
   * conversation-switch reset above uses, not a `useEffect`, because
   * `react-hooks/set-state-in-effect` (project convention) forbids a direct
   * setState in an effect body here and this doesn't need one: it is a pure
   * function of props, not a subscription to anything external.
   */
  const freshTitleDraft = detail.title ?? "";
  if (!open && (scopeChoice !== detail.slowModeScope || titleDraft !== freshTitleDraft || error !== null)) {
    setScopeChoice(detail.slowModeScope);
    setTitleDraft(freshTitleDraft);
    setError(null);
  }

  useEffect(() => {
    if (!transition.render) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose, transition.render]);

  if (!mounted || !transition.render) return null;

  const closing = transition.phase === "closing";
  const isGroup = detail.kind === "group";
  const capabilities = detail.capabilities;
  const ownerName =
    detail.members.find((member) => member.profileId === detail.ownerProfileId)?.name ??
    roster.find((member) => member.profileId === detail.ownerProfileId)?.name ??
    "—";

  async function run(operation: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const nextError = await operation();
    setBusy(false);
    if (nextError) setError(nextError);
    return nextError === null;
  }

  const adminIds = new Set(detail.admins.map((admin) => admin.profileId));
  const nonAdminMembers = detail.members.filter(
    (member) => member.profileId !== detail.ownerProfileId && !adminIds.has(member.profileId),
  );
  const availableToAdd = roster.filter(
    (member) => !detail.members.some((existing) => existing.profileId === member.profileId),
  );

  /* A delegated admin can only hand out capabilities they themselves hold; the owner can grant all five. */
  const grantableCapabilities = teamConversationCapabilities.filter(
    (capability) => capabilities.isOwner || capabilityFlag(capabilities, capability),
  );

  return createPortal(
    <div
      className={[
        styles.messageActionBackdrop,
        closing ? styles.messageActionBackdropClosing : styles.messageActionBackdropOpen,
      ].join(" ")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Conversation settings"
        className={[
          styles.messageActionCard,
          styles.controlsCard,
          closing ? styles.messageActionCardClosing : styles.messageActionCardOpen,
        ].join(" ")}
      >
        <div className={styles.messageActionCardHeader}>
          <strong>Conversation settings</strong>
          <button
            type="button"
            className={styles.messageActionClose}
            onClick={onClose}
            aria-label="Close conversation settings"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className={styles.controlsBody}>
          {isGroup ? (
            <p className={styles.controlsOwnerLine}>
              <ShieldCheck aria-hidden="true" size={13} />
              Owner: {ownerName}
            </p>
          ) : null}

          {isGroup && capabilities.canRenameConversation ? (
            <section className={styles.controlsSection}>
              <h4 className={styles.controlsSectionTitle}>Group name</h4>
              <div className={styles.controlsFieldRow}>
                <input
                  className={styles.controlsTextInput}
                  value={titleDraft}
                  maxLength={teamGroupTitleMaxLength}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  aria-label="Group name"
                />
                <button
                  type="button"
                  className={styles.controlsSmallButton}
                  disabled={busy || !titleDraft.trim() || titleDraft.trim() === detail.title}
                  onClick={() => void run(() => onRename(titleDraft.trim()))}
                >
                  Save
                </button>
              </div>
            </section>
          ) : null}

          {/*
           * Secondary only, per decision: Slow Mode's PRIMARY control is now
           * the quick-access clock icon in the conversation header
           * (`TeamSlowModeControl`), which owns turning it on, modifying the
           * duration, and stopping it. This section keeps just the status
           * line (for members who never open this dialog at all) and the
           * enforcement-scope choice, which has no other home.
           */}
          <section className={styles.controlsSection}>
            <h4 className={styles.controlsSectionTitle}>
              <Clock aria-hidden="true" size={13} />
              Slow Mode
            </h4>
            <p className={styles.controlsSummary}>
              {detail.slowModeSeconds
                ? `On · ${formatSlowModeSeconds(detail.slowModeSeconds)} · ${teamSlowModeScopeLabels[detail.slowModeScope]}`
                : "Off"}
            </p>
            {capabilities.canManageSlowMode ? (
              <>
                <p className={styles.controlsSummary}>
                  Turn Slow Mode on, modify it, or stop it from the clock icon
                  in the conversation header. Who it applies to:
                </p>
                <div className={styles.controlsPresetRow}>
                  {teamSlowModeScopes.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      className={[
                        styles.controlsPresetButton,
                        scopeChoice === scope ? styles.controlsPresetButtonActive : "",
                      ].join(" ")}
                      onClick={() => setScopeChoice(scope)}
                    >
                      {teamSlowModeScopeLabels[scope]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.controlsSmallButton}
                  disabled={busy || scopeChoice === detail.slowModeScope}
                  onClick={() => void run(() => onSetSlowMode(detail.slowModeSeconds, scopeChoice))}
                >
                  Save scope
                </button>
              </>
            ) : null}
          </section>

          <section className={styles.controlsSection}>
            <h4 className={styles.controlsSectionTitle}>Who can create tasks</h4>
            <p className={styles.controlsSummary}>
              {teamTaskCreationPolicyLabels[detail.taskCreationPolicy]}
            </p>
            {capabilities.canManageTaskPolicy ? (
              <div className={styles.controlsPresetRow}>
                {teamTaskCreationPolicies.map((policy) => (
                  <button
                    key={policy}
                    type="button"
                    className={[
                      styles.controlsPresetButton,
                      detail.taskCreationPolicy === policy ? styles.controlsPresetButtonActive : "",
                    ].join(" ")}
                    disabled={busy}
                    onClick={() => void run(() => onSetTaskCreationPolicy(policy))}
                  >
                    {teamTaskCreationPolicyLabels[policy]}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {isGroup ? (
            <section className={styles.controlsSection}>
              <h4 className={styles.controlsSectionTitle}>
                Members · {detail.members.length}
              </h4>
              <div className={styles.controlsMemberList}>
                {detail.members.map((member) => (
                  <div key={member.profileId} className={styles.controlsMemberRow}>
                    <span>
                      {member.name}
                      {member.profileId === detail.ownerProfileId ? (
                        <em className={styles.controlsRoleTag}>Owner</em>
                      ) : adminIds.has(member.profileId) ? (
                        <em className={styles.controlsRoleTag}>Admin</em>
                      ) : null}
                    </span>
                    {capabilities.canManageMembers &&
                    member.profileId !== detail.ownerProfileId &&
                    /*
                     * Removing a delegated admin also revokes their admin
                     * grant server-side, so that removal additionally
                     * requires manage_admins there (app_remove_team_
                     * conversation_member) — mirror it here so a
                     * manage_members-only actor never sees a control that
                     * the server will refuse.
                     */
                    (!adminIds.has(member.profileId) || capabilities.canManageAdmins) ? (
                      <button
                        type="button"
                        className={styles.controlsIconButton}
                        disabled={busy}
                        aria-label={`Remove ${member.name}`}
                        onClick={() => void run(() => onRemoveMember(member.profileId))}
                      >
                        <UserMinus aria-hidden="true" size={13} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              {capabilities.canManageMembers ? (
                <div className={styles.controlsFieldRow}>
                  <select
                    className={styles.controlsSelect}
                    value={addMemberId}
                    onChange={(event) => setAddMemberId(event.target.value)}
                    aria-label="Add a teammate to this group"
                  >
                    <option value="">Add a teammate…</option>
                    {availableToAdd.map((member) => (
                      <option key={member.profileId} value={member.profileId}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.controlsSmallButton}
                    disabled={busy || !addMemberId}
                    onClick={() =>
                      void run(() => onAddMember(addMemberId)).then((ok) => {
                        if (ok) setAddMemberId("");
                      })
                    }
                  >
                    <UserPlus aria-hidden="true" size={13} />
                    Add
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {isGroup ? (
            <section className={styles.controlsSection}>
              <h4 className={styles.controlsSectionTitle}>Delegated admins</h4>
              {detail.admins.length === 0 ? (
                <p className={styles.controlsSummary}>Only the owner has authority here.</p>
              ) : (
                <div className={styles.controlsMemberList}>
                  {detail.admins.map((admin) => (
                    <div key={admin.profileId} className={styles.controlsMemberRow}>
                      <span>
                        {admin.name}
                        <small className={styles.controlsCapabilitySummary}>
                          {teamConversationCapabilities
                            .filter((capability) => capabilityFlag(admin, capability))
                            .map((capability) => teamConversationCapabilityLabels[capability])
                            .join(", ") || "No capabilities"}
                        </small>
                      </span>
                      {capabilities.canManageAdmins ? (
                        <button
                          type="button"
                          className={styles.controlsIconButton}
                          disabled={busy}
                          aria-label={`Remove ${admin.name} as admin`}
                          onClick={() => void run(() => onRevokeAdmin(admin.profileId))}
                        >
                          <UserMinus aria-hidden="true" size={13} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {capabilities.canManageAdmins && nonAdminMembers.length > 0 ? (
                <div className={styles.controlsGrantForm}>
                  <select
                    className={styles.controlsSelect}
                    value={grantTargetId}
                    onChange={(event) => setGrantTargetId(event.target.value)}
                    aria-label="Make a teammate an admin"
                  >
                    <option value="">Make an admin…</option>
                    {nonAdminMembers.map((member) => (
                      <option key={member.profileId} value={member.profileId}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                  <div className={styles.controlsCapabilityGrid}>
                    {grantableCapabilities.map((capability) => (
                      <label key={capability} className={styles.controlsCapabilityCheckbox}>
                        <input
                          type="checkbox"
                          checked={Boolean(grantCapabilities[capability])}
                          onChange={(event) =>
                            setGrantCapabilities((current) => ({
                              ...current,
                              [capability]: event.target.checked,
                            }))
                          }
                        />
                        {teamConversationCapabilityLabels[capability]}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.controlsSmallButton}
                    disabled={
                      busy || !grantTargetId || !Object.values(grantCapabilities).some(Boolean)
                    }
                    onClick={() =>
                      void run(() => onGrantAdmin(grantTargetId, grantCapabilities)).then((ok) => {
                        if (ok) {
                          setGrantTargetId("");
                          setGrantCapabilities({});
                        }
                      })
                    }
                  >
                    <Check aria-hidden="true" size={13} />
                    Grant
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        {busy ? (
          <div className={styles.controlsBusyRow} aria-live="polite">
            <Loader2 className={styles.spin} aria-hidden="true" size={13} />
          </div>
        ) : null}
        {error ? (
          <p className={styles.messageActionError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

type TeamConversationCapabilityFlags = {
  canManageMembers: boolean;
  canManageAdmins: boolean;
  canManageSlowMode: boolean;
  canRenameConversation: boolean;
  canManageTaskPolicy: boolean;
};

function capabilityFlag(
  flags: TeamConversationCapabilityFlags,
  capability: TeamConversationCapability,
): boolean {
  switch (capability) {
    case "manage_members":
      return flags.canManageMembers;
    case "manage_admins":
      return flags.canManageAdmins;
    case "manage_slow_mode":
      return flags.canManageSlowMode;
    case "rename_conversation":
      return flags.canRenameConversation;
    case "manage_task_policy":
      return flags.canManageTaskPolicy;
    default:
      return false;
  }
}

export function formatSlowModeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.round((seconds / 60) * 10) / 10}m`;
}
