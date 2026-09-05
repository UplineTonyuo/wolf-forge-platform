"use client";

import { Check, ChevronLeft, Loader2, Settings, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { TeamConversationDetailView, TeamMemberView } from "../../domain/team/projections";
import { SearchableSelect, type SearchableOption } from "../ui/searchable-select";
import {
  teamConversationCapabilities,
  teamConversationCapabilityLabels,
  teamGroupTitleMaxLength,
  teamSlowModeMaxSeconds,
  teamSlowModeScopeLabels,
  teamSlowModeScopes,
  teamTaskCreationPolicies,
  type TeamConversationCapability,
  type TeamSlowModeScope,
  type TeamTaskCreationPolicy,
} from "../../domain/team/schema";
import { TeamAvatar } from "./team-avatar";
import { TeamConversationAvatar } from "./team-conversation-avatar";
import styles from "./team-messages.module.css";

const slowModeOptions = [
  { seconds: null, label: "Off" },
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1m" },
  { seconds: 300, label: "5m" },
] as const;

const taskPolicyDescriptions: Record<TeamTaskCreationPolicy, string> = {
  owner_only: "Only the conversation owner can create tasks",
  admins_and_owner: "Delegated admins and the owner can create tasks",
  everyone: "Anyone in this conversation can create tasks",
};

type SaveState = "idle" | "saving" | "saved";

/** Integrated settings panel. All authority remains server-derived and server-enforced. */
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
  roster: TeamMemberView[];
  onClose: () => void;
  onRename: (title: string) => Promise<string | null>;
  onSetSlowMode: (seconds: number | null, scope: TeamSlowModeScope) => Promise<string | null>;
  onSetTaskCreationPolicy: (policy: TeamTaskCreationPolicy) => Promise<string | null>;
  onGrantAdmin: (targetProfileId: string, capabilities: Partial<Record<TeamConversationCapability, boolean>>) => Promise<string | null>;
  onRevokeAdmin: (targetProfileId: string) => Promise<string | null>;
  onAddMember: (profileId: string) => Promise<string | null>;
  onRemoveMember: (profileId: string) => Promise<string | null>;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(detail.title ?? "");
  const [customOpen, setCustomOpen] = useState(false);
  const [customSeconds, setCustomSeconds] = useState("");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberId, setAddMemberId] = useState("");
  const [permissionTargetId, setPermissionTargetId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<Partial<Record<TeamConversationCapability, boolean>>>({});

  const freshTitle = detail.title ?? "";
  if (!open && (
    titleDraft !== freshTitle ||
    error !== null ||
    permissionTargetId !== null ||
    customOpen ||
    customSeconds !== "" ||
    addMemberOpen ||
    addMemberId !== "" ||
    saveState !== "idle"
  )) {
    setTitleDraft(freshTitle);
    setError(null);
    setPermissionTargetId(null);
    setPermissionDraft({});
    setCustomOpen(false);
    setCustomSeconds("");
    setAddMemberOpen(false);
    setAddMemberId("");
    setSaveState("idle");
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const isGroup = detail.kind === "group";
  const capabilities = detail.capabilities;
  const ownerName = detail.members.find((member) => member.profileId === detail.ownerProfileId)?.name
    ?? roster.find((member) => member.profileId === detail.ownerProfileId)?.name
    ?? "Not available";
  const memberCount = detail.members.length || (detail.otherMember ? 2 : 1);
  const adminIds = new Set(detail.admins.map((admin) => admin.profileId));
  const availableToAdd = roster.filter((member) => !detail.members.some((existing) => existing.profileId === member.profileId));
  const addMemberOptions: SearchableOption[] = availableToAdd.map((member) => ({
    id: member.profileId,
    label: member.name,
    sublabel: "Member",
  }));
  const titleDirty = titleDraft.trim() !== freshTitle && titleDraft.trim().length > 0;
  const currentPreset = slowModeOptions.some((option) => option.seconds === detail.slowModeSeconds);
  const validCustom = isValidCustomSlowModeSeconds(customSeconds);
  const permissionTarget = permissionTargetId
    ? detail.members.find((member) => member.profileId === permissionTargetId) ?? null
    : null;
  const permissionAdmin = permissionTargetId
    ? detail.admins.find((admin) => admin.profileId === permissionTargetId) ?? null
    : null;
  const grantableCapabilities = teamConversationCapabilities.filter(
    (capability) => capabilities.isOwner || capabilityFlag(capabilities, capability),
  );

  async function run(action: string, operation: () => Promise<string | null>) {
    setBusyAction(action);
    setSaveState("saving");
    setError(null);
    const nextError = await operation();
    setBusyAction(null);
    if (nextError) {
      setSaveState("idle");
      setError(nextError);
      return false;
    }
    setSaveState("saved");
    return true;
  }

  function openPermissionEditor(profileId: string) {
    const existingAdmin = detail.admins.find((admin) => admin.profileId === profileId);
    setPermissionTargetId(profileId);
    setPermissionDraft(Object.fromEntries(grantableCapabilities.map((capability) => [
      capability,
      existingAdmin ? capabilityFlag(existingAdmin, capability) : false,
    ])));
    setError(null);
  }

  return (
    <aside
      className={[styles.settingsPanel, open ? styles.settingsPanelOpen : ""].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
    >
      <div className={styles.settingsPanelInner}>
        <header className={styles.settingsPanelHeader}>
          <span>
            <h2 id={titleId}>Conversation settings</h2>
            <p>Manage this conversation</p>
          </span>
          <button ref={closeRef} type="button" className={styles.settingsCloseButton} onClick={onClose} aria-label="Close conversation settings" title="Close settings">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className={styles.settingsScroll}>
          <div className={styles.settingsIdentity}>
            {isGroup ? (
              <TeamConversationAvatar imageUrl={detail.imageUrl} className={styles.settingsIdentityAvatar} />
            ) : detail.otherMember ? (
              <TeamAvatar name={detail.otherMember.name} initials={detail.otherMember.initials} avatarUrl={detail.otherMember.avatarUrl} />
            ) : null}
            <span className={styles.settingsIdentityText}>
              <strong>{detail.name}</strong>
              <small>{memberCount} {memberCount === 1 ? "member" : "members"}{isGroup ? ` · Owner: ${ownerName}` : ""}</small>
            </span>
          </div>

          {permissionTarget ? (
            <section className={styles.permissionEditor} aria-label={`Permissions for ${permissionTarget.name}`}>
              <button type="button" className={styles.settingsBackButton} onClick={() => setPermissionTargetId(null)}>
                <ChevronLeft aria-hidden="true" /> Back to members
              </button>
              <div className={styles.permissionEditorIdentity}>
                <TeamAvatar name={permissionTarget.name} initials={permissionTarget.initials} avatarUrl={permissionTarget.avatarUrl} small />
                <span><strong>{permissionTarget.name}</strong><small>{permissionAdmin ? "Delegated admin" : "Member"}</small></span>
              </div>

              {capabilities.canManageAdmins ? (
                <>
                  <h3>Permissions</h3>
                  <div className={styles.permissionList}>
                    {grantableCapabilities.map((capability) => (
                      <label key={capability} className={styles.permissionCheckRow}>
                        <input
                          type="checkbox"
                          checked={Boolean(permissionDraft[capability])}
                          disabled={busyAction !== null}
                          onChange={(event) => setPermissionDraft((current) => ({ ...current, [capability]: event.target.checked }))}
                        />
                        <span>{permissionLabel(capability)}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.settingsPrimaryButton}
                    disabled={busyAction !== null || !Object.values(permissionDraft).some(Boolean)}
                    onClick={() => void run("permissions", () => onGrantAdmin(permissionTarget.profileId, permissionDraft))}
                  >
                    {busyAction === "permissions" ? <Loader2 className={styles.spin} aria-hidden="true" /> : <Check aria-hidden="true" />}
                    Save permissions
                  </button>
                  {permissionAdmin ? (
                    <button
                      type="button"
                      className={styles.settingsDangerButton}
                      disabled={busyAction !== null}
                      onClick={() => void run("revoke-admin", () => onRevokeAdmin(permissionTarget.profileId)).then((ok) => { if (ok) setPermissionTargetId(null); })}
                    >
                      Remove admin access
                    </button>
                  ) : null}
                </>
              ) : null}

              {capabilities.canManageMembers && permissionTarget.profileId !== detail.ownerProfileId && (!permissionAdmin || capabilities.canManageAdmins) ? (
                <button
                  type="button"
                  className={styles.settingsDangerButton}
                  disabled={busyAction !== null}
                  onClick={() => void run("remove-member", () => onRemoveMember(permissionTarget.profileId)).then((ok) => { if (ok) setPermissionTargetId(null); })}
                >
                  <UserMinus aria-hidden="true" /> Remove from conversation
                </button>
              ) : null}
            </section>
          ) : (
            <>
              <section className={styles.settingsSection}>
                <div className={styles.settingsSectionHeading}><h3>General</h3></div>
                {isGroup ? (
                  <label className={styles.settingsField}>
                    <span>Group name</span>
                    <span className={styles.settingsTextRow}>
                      <input
                        value={titleDraft}
                        maxLength={teamGroupTitleMaxLength}
                        disabled={!capabilities.canRenameConversation || busyAction !== null}
                        onChange={(event) => { setTitleDraft(event.target.value); setSaveState("idle"); }}
                      />
                      <button
                        type="button"
                        className={styles.settingsSaveButton}
                        disabled={!titleDirty || busyAction !== null}
                        onClick={() => void run("rename", () => onRename(titleDraft.trim()))}
                      >
                        {busyAction === "rename" ? "Saving…" : "Save"}
                      </button>
                    </span>
                  </label>
                ) : <p className={styles.settingsReadOnlyValue}>{detail.name}</p>}
              </section>

              <section className={styles.settingsSection}>
                <div className={styles.settingsSectionHeading}><span><h3>Slow Mode</h3><p>Control how frequently people can send messages.</p></span></div>
                <div className={styles.segmentedControl} role="radiogroup" aria-label="Slow Mode duration">
                  {slowModeOptions.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      role="radio"
                      aria-checked={detail.slowModeSeconds === option.seconds}
                      className={detail.slowModeSeconds === option.seconds ? styles.segmentedControlActive : ""}
                      disabled={!capabilities.canManageSlowMode || busyAction !== null}
                      onClick={() => { setCustomOpen(false); void run("slow-mode", () => onSetSlowMode(option.seconds, detail.slowModeScope)); }}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={detail.slowModeSeconds !== null && !currentPreset}
                    className={detail.slowModeSeconds !== null && !currentPreset ? styles.segmentedControlActive : ""}
                    disabled={!capabilities.canManageSlowMode || busyAction !== null}
                    onClick={() => setCustomOpen(true)}
                  >Custom</button>
                </div>
                {customOpen ? (
                  <div className={styles.customSlowModeRow}>
                    <label><span>Custom seconds</span><input type="number" min={1} max={teamSlowModeMaxSeconds} value={customSeconds} onChange={(event) => setCustomSeconds(event.target.value)} disabled={busyAction !== null} /></label>
                    <button
                      type="button"
                      className={styles.settingsPrimaryButton}
                      disabled={!validCustom || busyAction !== null}
                      onClick={() => void run("slow-mode", () => onSetSlowMode(Number(customSeconds), detail.slowModeScope)).then((ok) => { if (ok) setCustomOpen(false); })}
                    >Set</button>
                  </div>
                ) : null}
                <fieldset className={styles.scopeFieldset} disabled={!capabilities.canManageSlowMode || detail.slowModeSeconds === null || busyAction !== null}>
                  <legend>Applies to</legend>
                  <div className={styles.scopeControl}>
                    {teamSlowModeScopes.map((scope) => (
                      <button key={scope} type="button" aria-pressed={detail.slowModeScope === scope} onClick={() => void run("slow-mode-scope", () => onSetSlowMode(detail.slowModeSeconds, scope))}>
                        {teamSlowModeScopeLabels[scope]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <p className={styles.slowModeStatus}>
                  {detail.slowModeSeconds === null
                    ? "Slow Mode is off."
                    : `${detail.slowModeScope === "members_only" ? "Members" : "Members and admins"} can send one message every ${formatSlowModeDuration(detail.slowModeSeconds)}.`}
                  <span>Owner is always exempt.</span>
                </p>
              </section>

              <section className={styles.settingsSection}>
                <div className={styles.settingsSectionHeading}><h3>Who can create tasks</h3></div>
                <div className={styles.taskPolicyList} role="radiogroup" aria-label="Who can create tasks">
                  {teamTaskCreationPolicies.map((policy) => (
                    <button
                      key={policy}
                      type="button"
                      role="radio"
                      aria-checked={detail.taskCreationPolicy === policy}
                      className={detail.taskCreationPolicy === policy ? styles.taskPolicyActive : ""}
                      disabled={!capabilities.canManageTaskPolicy || busyAction !== null}
                      onClick={() => void run("task-policy", () => onSetTaskCreationPolicy(policy))}
                    >
                      <span className={styles.radioMark} aria-hidden="true" />
                      <span><strong>{taskPolicyLabel(policy)}</strong><small>{taskPolicyDescriptions[policy]}</small></span>
                    </button>
                  ))}
                </div>
              </section>

              {isGroup ? (
                <section className={styles.settingsSection}>
                  <div className={styles.settingsSectionHeading}>
                    <h3>Members · {detail.members.length}</h3>
                    {capabilities.canManageMembers ? (
                      <button type="button" className={styles.settingsTextButton} aria-expanded={addMemberOpen} onClick={() => setAddMemberOpen((value) => !value)}>
                        <UserPlus aria-hidden="true" /> Add member
                      </button>
                    ) : null}
                  </div>
                  {addMemberOpen ? (
                    <div className={styles.addMemberControl}>
                      <SearchableSelect
                        className={styles.memberPicker}
                        menuClassName={styles.memberPickerMenu}
                        label="Teammate to add"
                        menuLabel="Available teammates"
                        placeholder="Search or choose teammate…"
                        emptyMessage="No teammates available to add."
                        options={addMemberOptions}
                        value={addMemberId}
                        disabled={busyAction !== null || availableToAdd.length === 0}
                        onChange={setAddMemberId}
                        renderOption={(option) => {
                          const member = availableToAdd.find((candidate) => candidate.profileId === option.id);
                          if (!member) return option.label;
                          return (
                            <span className={styles.memberPickerOption}>
                              <TeamAvatar name={member.name} initials={member.initials} avatarUrl={member.avatarUrl} small />
                              <span>
                                <strong>{member.name}</strong>
                                <small>{option.sublabel}</small>
                              </span>
                            </span>
                          );
                        }}
                      />
                      <button
                        type="button"
                        className={styles.settingsPrimaryButton}
                        disabled={!addMemberId || busyAction !== null}
                        onClick={() => void run("add-member", () => onAddMember(addMemberId)).then((ok) => { if (ok) { setAddMemberId(""); setAddMemberOpen(false); } })}
                      >Add</button>
                    </div>
                  ) : null}
                  <div className={styles.settingsMemberList}>
                    {detail.members.map((member) => {
                      const isOwner = member.profileId === detail.ownerProfileId;
                      const isAdmin = adminIds.has(member.profileId);
                      const canManageMember = !isOwner && (capabilities.canManageAdmins || (capabilities.canManageMembers && !isAdmin));
                      return (
                        <div key={member.profileId} className={styles.settingsMemberRow}>
                          <TeamAvatar name={member.name} initials={member.initials} avatarUrl={member.avatarUrl} small />
                          <span className={styles.settingsMemberIdentity}>
                            <strong>{member.name}</strong>
                            <small>{isOwner ? "Conversation owner" : isAdmin ? "Delegated admin" : "Member"}</small>
                          </span>
                          <span className={styles.settingsMemberActions}>
                            <em className={[styles.settingsRoleBadge, isOwner ? styles.settingsRoleBadgeOwner : ""].filter(Boolean).join(" ")}>{isOwner ? "Owner" : isAdmin ? "Admin" : "Member"}</em>
                            {canManageMember ? (
                              <button type="button" className={styles.settingsMemberManage} aria-label={`Manage ${member.name}`} title={`Manage ${member.name}`} onClick={() => openPermissionEditor(member.profileId)}>
                                <Settings aria-hidden="true" />
                              </button>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </>
          )}

          {saveState !== "idle" ? (
            <p className={styles.settingsSaveStatus} aria-live="polite">
              {saveState === "saving" ? <><Loader2 className={styles.spin} aria-hidden="true" /> Saving…</> : <><Check aria-hidden="true" /> Saved</>}
            </p>
          ) : null}
          {error ? <p className={styles.settingsError} role="alert">{error}</p> : null}
        </div>
      </div>
    </aside>
  );
}

type TeamConversationCapabilityFlags = {
  canManageMembers: boolean;
  canManageAdmins: boolean;
  canManageSlowMode: boolean;
  canRenameConversation: boolean;
  canManageTaskPolicy: boolean;
};

function capabilityFlag(flags: TeamConversationCapabilityFlags, capability: TeamConversationCapability): boolean {
  switch (capability) {
    case "manage_members": return flags.canManageMembers;
    case "manage_admins": return flags.canManageAdmins;
    case "manage_slow_mode": return flags.canManageSlowMode;
    case "rename_conversation": return flags.canRenameConversation;
    case "manage_task_policy": return flags.canManageTaskPolicy;
    default: return false;
  }
}

function taskPolicyLabel(policy: TeamTaskCreationPolicy): string {
  if (policy === "admins_and_owner") return "Admins and owner";
  if (policy === "owner_only") return "Owner only";
  return "Everyone";
}

function permissionLabel(capability: TeamConversationCapability): string {
  switch (capability) {
    case "manage_slow_mode": return "Manage Slow Mode";
    case "rename_conversation": return "Rename conversation";
    case "manage_task_policy": return "Manage task policy";
    default: return teamConversationCapabilityLabels[capability];
  }
}

function isValidCustomSlowModeSeconds(value: string): boolean {
  if (value.trim() === "") return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= teamSlowModeMaxSeconds;
}

export function formatSlowModeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.round((seconds / 60) * 10) / 10}m`;
}

function formatSlowModeDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${Math.round((seconds / 60) * 10) / 10} minutes`;
}
