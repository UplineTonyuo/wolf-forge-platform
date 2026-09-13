"use client";

import { ArrowLeft, Check, MessageSquare, Search, UsersRound } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { filterTeamMembers, type TeamMemberView } from "../../domain/team/projections";
import { TeamAvatar } from "./team-avatar";
import type { TeamPresenceStatus } from "./team-presence-provider";
import styles from "./team-messages.module.css";

type CreatorMode = "choose" | "direct" | "group";

export function TeamConversationCreator({ members, statusFor, onStartDirect, onCreateGroup, busy, error }: {
  members: TeamMemberView[];
  statusFor: (profileId: string) => TeamPresenceStatus;
  onStartDirect: (profileId: string) => void;
  onCreateGroup: (title: string, memberProfileIds: string[]) => void;
  busy: boolean;
  error: string | null;
}) {
  const [mode, setMode] = useState<CreatorMode>("choose");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const results = useMemo(() => filterTeamMembers(members, query), [members, query]);
  const resolvedActiveIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  const chooseMember = (member: TeamMemberView) => {
    if (mode === "direct") {
      onStartDirect(member.profileId);
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(member.profileId)) next.delete(member.profileId);
      else next.add(member.profileId);
      return next;
    });
  };

  if (mode === "choose") {
    return (
      <div className={styles.creatorChoices}>
        <button type="button" className={styles.creatorChoice} onClick={() => setMode("direct")}>
          <span><MessageSquare aria-hidden="true" /></span>
          <span><strong>New message</strong><small>Start a private conversation</small></span>
        </button>
        <button type="button" className={styles.creatorChoice} onClick={() => setMode("group")}>
          <span><UsersRound aria-hidden="true" /></span>
          <span><strong>New group</strong><small>Bring teammates into one thread</small></span>
        </button>
      </div>
    );
  }

  const heading = mode === "group" ? "Create group" : "New message";
  const canCreate = title.trim().length > 0 && selected.size >= 2 && !busy;

  return (
    <div className={styles.creatorPanel}>
      <div className={styles.creatorHeader}>
        <button type="button" className={styles.creatorBack} onClick={() => setMode("choose")} aria-label="Back">
          <ArrowLeft aria-hidden="true" />
        </button>
        <strong>{heading}</strong>
      </div>

      {mode === "group" ? (
        <label className={styles.creatorField}>
          <span>Group name</span>
          <input value={title} maxLength={80} placeholder="SEO Team" onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>
      ) : null}

      <label className={styles.creatorSearch}>
        <Search aria-hidden="true" />
        <input
          value={query}
          placeholder="Search teammates…"
          aria-label="Search teammates"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-activedescendant={results[resolvedActiveIndex] ? `${listboxId}-${resolvedActiveIndex}` : undefined}
          autoFocus={mode === "direct"}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (query) setQuery("");
              else setMode("choose");
              setActiveIndex(0);
              return;
            }
            if (results.length === 0) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              const next = (resolvedActiveIndex + direction + results.length) % results.length;
              setActiveIndex(next);
              requestAnimationFrame(() => {
                document.getElementById(`${listboxId}-${next}`)?.scrollIntoView({ block: "nearest" });
              });
              return;
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setActiveIndex(event.key === "Home" ? 0 : results.length - 1);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              chooseMember(results[resolvedActiveIndex]!);
            }
          }}
        />
      </label>

      <div id={listboxId} className={styles.creatorMembers} role="listbox" aria-label="Active internal teammates" aria-multiselectable={mode === "group" ? "true" : undefined}>
        {results.length === 0 ? (
          <p className={styles.creatorEmpty}>No active teammate matches that.</p>
        ) : results.map((member, index) => {
          const checked = selected.has(member.profileId);
          return (
            <button
              key={member.profileId}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={mode === "group" ? checked : index === resolvedActiveIndex}
              tabIndex={-1}
              className={[styles.creatorMember, checked ? styles.creatorMemberSelected : "", index === resolvedActiveIndex ? styles.creatorMemberActive : ""].filter(Boolean).join(" ")}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseMember(member)}
            >
              <TeamAvatar name={member.name} initials={member.initials} avatarUrl={member.avatarUrl} small presence={statusFor(member.profileId)} />
              <span className={styles.creatorMemberIdentity}>
                <strong>{member.name}</strong>
                {member.email ? <small>{member.email}</small> : null}
              </span>
              {mode === "group" ? <span className={styles.creatorCheck}>{checked ? <Check aria-hidden="true" /> : null}</span> : null}
            </button>
          );
        })}
      </div>

      {error ? <p className={styles.creatorError} role="alert">{error}</p> : null}

      {mode === "group" ? (
        <div className={styles.creatorFooter}>
          <span>{selected.size} selected · 3 members minimum including you</span>
          <button type="button" className={styles.primaryButton} aria-busy={busy || undefined} disabled={!canCreate} onClick={() => onCreateGroup(title.trim(), [...selected])}>
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
