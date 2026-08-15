"use client";

import {
  Check,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { setMemberPresetAction } from "../../app/actions/member-account-provisioning";
import type {
  InternalMember,
  PermissionPresetGrant,
  PermissionPresetOverview,
} from "../../domain/permissions/schema";
import styles from "./team-roles-panel.module.css";

type View = "team" | "roles";

export type TeamRolesPanelProps = {
  members: InternalMember[];
  presets: PermissionPresetOverview[];
  grants: PermissionPresetGrant[];
  /** users.create + users.manage_permissions, re-checked by the database. */
  canAddMembers: boolean;
  /** users.manage_permissions, re-checked by the database. */
  canManagePermissions: boolean;
  createdMember?: boolean;
};

/**
 * The presets a member can be moved between from this screen. Owner is absent
 * on purpose: it is not an ordinary reassignment, and the resolver gives it a
 * blanket bypass.
 */
const assignablePresetKeys = ["admin", "manager", "staff"] as const;

/**
 * Presentation only. Capability categories come from public.permissions; this
 * just gives the well-known ones a nicer heading than a raw key would read as.
 */
const categoryHeadings: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Projects",
  tickets: "Tickets",
  clients: "Clients",
  todo: "To Do",
  billing: "Billing",
  marketing: "Marketing",
  services: "Services",
  forms: "Forms",
  users: "Team",
  settings: "Settings",
};

function categoryHeading(category: string) {
  return (
    categoryHeadings[category]
    ?? category.replace(/_/gu, " ").replace(/^./u, (first) => first.toUpperCase())
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function roleClass(presetKey: string) {
  if (presetKey === "owner") {
    return styles.roleOwner;
  }

  if (presetKey === "admin") {
    return styles.roleAdmin;
  }

  if (presetKey === "manager") {
    return styles.roleManager;
  }

  if (presetKey === "staff") {
    return styles.roleStaff;
  }

  return styles.roleClient;
}

function memberName(member: InternalMember) {
  return member.display_name ?? member.email ?? "Unnamed member";
}

/** Why this member's preset cannot be changed here, or null when it can be. */
function blockedReason(
  member: InternalMember,
  canManagePermissions: boolean,
): string | null {
  if (!canManagePermissions) {
    return "You do not have permission to change roles.";
  }

  if (member.is_self) {
    return "You cannot change your own role.";
  }

  if (member.preset_key === "owner") {
    return "The Owner role is protected.";
  }

  return null;
}

export function TeamRolesPanel({
  members,
  presets,
  grants,
  canAddMembers,
  canManagePermissions,
  createdMember = false,
}: TeamRolesPanelProps) {
  const router = useRouter();

  const [view, setView] = useState<View>("team");

  const [selectedPreset, setSelectedPreset] = useState<string>(
    () => presets.find((preset) => preset.preset_key === "manager")?.preset_key
      ?? presets[0]?.preset_key
      ?? "",
  );

  const [search, setSearch] = useState("");

  const [notice, setNotice] = useState<string | null>(
    createdMember ? "The team member was created and can sign in now." : null,
  );

  const [pendingMember, setPendingMember] = useState<InternalMember | null>(null);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (pendingMember && !dialog.open) {
      dialog.showModal();
    }

    if (!pendingMember && dialog.open) {
      dialog.close();
    }
  }, [pendingMember]);

  const presetsByKey = useMemo(
    () => new Map(presets.map((preset) => [preset.preset_key, preset])),
    [presets],
  );

  const selected = presetsByKey.get(selectedPreset) ?? presets[0] ?? null;

  /** Real preset grants grouped by the real capability category. */
  const selectedGroups = useMemo(() => {
    const groups = new Map<string, PermissionPresetGrant[]>();

    for (const grant of grants) {
      if (grant.preset_key !== selected?.preset_key) continue;
      const existing = groups.get(grant.category);
      if (existing) {
        existing.push(grant);
      } else {
        groups.set(grant.category, [grant]);
      }
    }

    return Array.from(groups.entries());
  }, [grants, selected]);

  const filteredTeam = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return members;
    }

    return members.filter(
      (member) =>
        memberName(member).toLowerCase().includes(query)
        || (member.email ?? "").toLowerCase().includes(query)
        || member.preset_name.toLowerCase().includes(query),
    );
  }, [members, search]);

  const ownerCount = presetsByKey.get("owner")?.member_count ?? 0;

  function openRole(presetKey: string) {
    setSelectedPreset(presetKey);
    setView("roles");
    setNotice(null);
  }

  function openRoleChange(member: InternalMember) {
    setPendingMember(member);
    setPendingPreset(
      assignablePresetKeys.includes(member.preset_key as (typeof assignablePresetKeys)[number])
        ? member.preset_key
        : null,
    );
    setDialogError(null);
    setNotice(null);
  }

  function closeRoleChange() {
    if (saving) return;
    setPendingMember(null);
    setPendingPreset(null);
    setDialogError(null);
  }

  function confirmRoleChange() {
    const member = pendingMember;
    const presetKey = pendingPreset;
    if (!member || !presetKey) return;

    if (presetKey === member.preset_key) {
      setDialogError("That is already this member's role.");
      return;
    }

    setDialogError(null);

    startSaving(async () => {
      const result = await setMemberPresetAction({
        profileId: member.profile_id,
        presetKey,
      });

      if (!result.ok) {
        setDialogError(result.error);
        return;
      }

      const presetName = presetsByKey.get(presetKey)?.preset_name ?? presetKey;
      setPendingMember(null);
      setPendingPreset(null);
      setNotice(`${memberName(member)} is now ${presetName}.`);
      router.refresh();
    });
  }

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>
            <LockKeyhole size={13} aria-hidden="true" />
            Access control
          </div>

          <h1>Team &amp; Roles</h1>

          <p>
            Manage people, roles, and workspace access from one control center.
          </p>
        </div>
      </header>

      <div className={styles.summaryStrip}>
        <div>
          <strong>{members.length}</strong>
          <span>Members</span>
        </div>

        <div>
          <strong>{presets.length}</strong>
          <span>Roles</span>
        </div>

        <div>
          <strong>{ownerCount}</strong>
          <span>Owner</span>
        </div>

        <div className={styles.summaryNote}>
          <ShieldCheck size={15} aria-hidden="true" />
          Role changes apply immediately and are audited.
        </div>
      </div>

      <div className={styles.viewBar}>
        <button
          type="button"
          className={view === "team" ? styles.viewActive : styles.viewButton}
          onClick={() => {
            setView("team");
            setNotice(null);
          }}
        >
          <UsersRound size={15} aria-hidden="true" />
          Team directory
        </button>

        <button
          type="button"
          className={view === "roles" ? styles.viewActive : styles.viewButton}
          onClick={() => {
            setView("roles");
            setNotice(null);
          }}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          Roles &amp; permissions
        </button>
      </div>

      {notice ? (
        <div className={styles.notice} role="status">
          {notice}

          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {view === "team" ? (
        <div className={styles.teamWorkspace}>
          <section className={styles.directoryPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Team directory</h2>
                <p>Wolf Forge workspace members.</p>
              </div>

              {canAddMembers ? (
                <Link
                  href="/accounts/member/new"
                  className={styles.directoryAddButton}
                >
                  <UserPlus size={14} aria-hidden="true" />
                  Add user
                </Link>
              ) : null}
            </div>

            <div className={styles.searchRow}>
              <Search size={15} aria-hidden="true" />

              <input
                type="search"
                placeholder="Search people, email, or role"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className={styles.teamList}>
              {filteredTeam.map((member) => {
                const blocked = blockedReason(member, canManagePermissions);
                const name = memberName(member);

                return (
                  <div className={styles.teamRow} key={member.profile_id}>
                    <div className={styles.avatar}>{initials(name)}</div>

                    <div className={styles.memberCopy}>
                      <strong>{name}</strong>
                      <span>{member.email ?? "No email on file"}</span>
                    </div>

                    <button
                      type="button"
                      className={`${styles.rolePill} ${roleClass(member.preset_key)}`}
                      onClick={() => openRole(member.preset_key)}
                    >
                      {member.preset_name}
                    </button>

                    <button
                      type="button"
                      className={styles.moreButton}
                      aria-label={`Change role for ${name}`}
                      title={blocked ?? `Change role for ${name}`}
                      disabled={blocked !== null}
                      onClick={() => openRoleChange(member)}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                  </div>
                );
              })}

              {filteredTeam.length === 0 ? (
                <div className={styles.noResults}>
                  {members.length === 0
                    ? "No Wolf Forge members yet."
                    : `No team members match “${search}”.`}
                </div>
              ) : null}
            </div>
          </section>

          <aside className={styles.roleMap}>
            <div className={styles.roleMapHeader}>
              <div>
                <h2>Role map</h2>
                <p>Access presets and current assignment.</p>
              </div>

              <ShieldCheck size={18} aria-hidden="true" />
            </div>

            <div className={styles.roleMapList}>
              {presets.map((preset) => {
                const percent = preset.total_permission_count > 0
                  ? Math.round(
                    (preset.granted_permission_count / preset.total_permission_count) * 100,
                  )
                  : 0;

                return (
                  <button
                    type="button"
                    key={preset.preset_key}
                    className={styles.roleMapRow}
                    onClick={() => openRole(preset.preset_key)}
                  >
                    <div className={styles.roleMapTop}>
                      <div>
                        <strong>{preset.preset_name}</strong>

                        <span>
                          {preset.member_count}{" "}
                          {preset.member_count === 1 ? "member" : "members"}
                        </span>
                      </div>

                      <ChevronRight size={15} />
                    </div>

                    <div className={styles.accessMeter}>
                      <span style={{ width: `${percent}%` }} />
                    </div>

                    <small>
                      {preset.granted_permission_count} of{" "}
                      {preset.total_permission_count} permissions
                    </small>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      ) : (
        <div className={styles.rolesWorkspace}>
          <aside className={styles.rolesRail}>
            <div className={styles.rolesRailTitle}>
              <span>Role presets</span>
            </div>

            {presets.map((preset) => {
              const active = preset.preset_key === selected?.preset_key;

              return (
                <button
                  type="button"
                  key={preset.preset_key}
                  className={active ? styles.roleRailActive : styles.roleRailButton}
                  onClick={() => {
                    setSelectedPreset(preset.preset_key);
                    setNotice(null);
                  }}
                >
                  <div>
                    <strong>{preset.preset_name}</strong>

                    <span>
                      {preset.member_count}{" "}
                      {preset.member_count === 1 ? "member" : "members"}
                    </span>
                  </div>

                  <ChevronRight size={15} />
                </button>
              );
            })}
          </aside>

          <section className={styles.permissionPanel}>
            <div className={styles.permissionHeader}>
              <div>
                <div className={styles.permissionTitle}>
                  <h2>{selected?.preset_name ?? "Role"}</h2>

                  {selected?.preset_key === "owner" ? (
                    <span>Locked full access</span>
                  ) : null}
                </div>

                <p>
                  {selected?.account_class === "client"
                    ? "Client portal preset. Client accounts are a separate security domain and never receive internal access."
                    : "Wolf Forge internal preset. Capabilities below are resolved by the database for every request."}
                </p>
              </div>

              <div className={styles.permissionScore}>
                <strong>{selected?.granted_permission_count ?? 0}</strong>
                <span>/ {selected?.total_permission_count ?? 0} active</span>
              </div>
            </div>

            <div className={styles.permissionBody}>
              {selectedGroups.map(([category, items]) => (
                <div className={styles.permissionGroup} key={category}>
                  <div className={styles.groupCopy}>
                    <h3>{categoryHeading(category)}</h3>

                    <p>
                      {items.filter((item) => item.allowed).length} of {items.length}{" "}
                      granted
                    </p>
                  </div>

                  <div className={styles.permissionOptions}>
                    {items.map((item) => (
                      <div
                        key={item.permission_key}
                        title={item.description || item.label}
                        className={`${styles.permissionReadOnly} ${
                          item.allowed ? styles.permissionGranted : styles.permissionDenied
                        }`}
                      >
                        <span>
                          {item.allowed ? <Check size={12} strokeWidth={3} /> : null}
                        </span>

                        {item.label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <footer className={styles.permissionFooter}>
              <div>
                <ShieldCheck size={15} />

                <span>
                  Preset grants are system-managed. Assign a preset from the team
                  directory to change what a member can reach.
                </span>
              </div>
            </footer>
          </section>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className={styles.roleDialog}
        aria-label="Change role"
        onCancel={(event) => {
          if (saving) {
            event.preventDefault();
            return;
          }
          closeRoleChange();
        }}
        onClose={closeRoleChange}
      >
        {pendingMember ? (
          <>
            <div className={styles.roleDialogHeader}>
              <h2>Change role</h2>

              <p>
                {memberName(pendingMember)} is currently {pendingMember.preset_name}.
                Choose the preset that should decide their access.
              </p>
            </div>

            <div className={styles.roleDialogOptions}>
              {assignablePresetKeys.map((presetKey) => {
                const preset = presetsByKey.get(presetKey);
                const active = pendingPreset === presetKey;

                return (
                  <button
                    type="button"
                    key={presetKey}
                    disabled={saving}
                    className={active ? styles.roleDialogOptionActive : styles.roleDialogOption}
                    aria-pressed={active}
                    onClick={() => {
                      setPendingPreset(presetKey);
                      setDialogError(null);
                    }}
                  >
                    {preset?.preset_name ?? presetKey}

                    <small>
                      {presetKey === pendingMember.preset_key
                        ? "Current"
                        : `${preset?.granted_permission_count ?? 0} permissions`}
                    </small>
                  </button>
                );
              })}
            </div>

            {dialogError ? (
              <p className={styles.roleDialogError} role="alert">
                {dialogError}
              </p>
            ) : null}

            <div className={styles.roleDialogActions}>
              <button
                type="button"
                className={styles.roleDialogCancel}
                disabled={saving}
                onClick={closeRoleChange}
              >
                Cancel
              </button>

              <button
                type="button"
                className={styles.roleDialogConfirm}
                disabled={saving || !pendingPreset}
                onClick={confirmRoleChange}
              >
                {saving ? (
                  <LoaderCircle
                    size={13}
                    className={styles.roleDialogSpinner}
                    aria-hidden="true"
                  />
                ) : null}

                {saving ? "Changing..." : "Change role"}
              </button>
            </div>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
