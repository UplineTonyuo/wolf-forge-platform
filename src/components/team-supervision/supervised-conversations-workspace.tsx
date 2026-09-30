"use client";

import { ChevronLeft, Eye, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  getSupervisedConversationAction,
  type TeamSupervisionActionResult,
} from "../../app/actions/team-supervision";
import type {
  SupervisedConversationPage,
  SupervisedConversationSummary,
  SupervisedTranscriptPage,
} from "../../domain/team-supervision/projections";
import type { ClientSafeError } from "../../lib/errors/application-error";
import { teamInitials } from "../../domain/team/projections";
import { TeamAvatar } from "../team/team-avatar";
import { SupervisedConversationList } from "./supervised-conversation-list";
import { SupervisedSearch } from "./supervised-search";
import { SupervisedTranscript } from "./supervised-transcript";
import styles from "./supervised-transcript.module.css";

/** Below this the list and the transcript take turns; matches the CSS split. */
const stackedQuery = "(max-width: 1023px)";

type Detail =
  | { state: "loading" }
  | { state: "ready"; page: SupervisedTranscriptPage }
  | { state: "error"; code: ClientSafeError["code"] };

/**
 * All Conversations: the list, and at most one supervised transcript.
 *
 * The transcript is read only from a row activation, never from render, an
 * effect, hover, focus or prefetch: each successful detail action writes one
 * OPEN audit, so one deliberate open must be exactly one call. Re-activating
 * the open (or opening) row does nothing; a late response for a conversation
 * that is no longer selected is dropped. Closing (mobile Back) forgets the
 * transcript, so viewing it again is a new, audited open.
 *
 * Opening the search box reads nothing; switching or closing a conversation
 * discards the search with it.
 */
export function SupervisedConversationsWorkspace({
  initial,
}: {
  initial: TeamSupervisionActionResult<SupervisedConversationPage>;
}) {
  const [selected, setSelected] = useState<SupervisedConversationSummary | null>(null);
  const [detail, setDetail] = useState<Detail>({ state: "loading" });
  const [searchOpen, setSearchOpen] = useState(false);
  const activeRef = useRef<{ id: string; failed: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);

  // Nothing to split: the list alone renders the empty, forbidden or failed state.
  if (!initial.ok || initial.data.conversations.length === 0) {
    return <SupervisedConversationList initial={initial} />;
  }

  async function open(conversation: SupervisedConversationSummary) {
    const id = conversation.conversationId;
    if (activeRef.current?.id === id && !activeRef.current.failed) return;
    const active = { id, failed: false };
    activeRef.current = active;
    setSelected(conversation);
    setDetail({ state: "loading" });
    setSearchOpen(false);

    // On narrow screens the row disappears under the transcript; move focus with it.
    if (window.matchMedia?.(stackedQuery).matches) {
      requestAnimationFrame(() => headingRef.current?.focus());
    }

    const result = await getSupervisedConversationAction({ conversationId: id });

    if (activeRef.current !== active) return;
    active.failed = !result.ok;
    setDetail(result.ok ? { state: "ready", page: result.data } : { state: "error", code: result.error.code });
  }

  function back() {
    const id = activeRef.current?.id;
    activeRef.current = null;
    setSelected(null);
    setDetail({ state: "loading" });
    setSearchOpen(false);
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(`[data-conversation-id="${id}"]`)?.focus(),
    );
  }

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false);
      return;
    }
    setSearchOpen(true);
    requestAnimationFrame(() => {
      // Stacked, the page is the scroll region: bring the panel top (header and
      // search) into view instead of leaving the box above the reader.
      if (window.matchMedia?.(stackedQuery).matches) panelRef.current?.scrollIntoView?.({ block: "start" });
      panelRef.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus({ preventScroll: true });
    });
  }

  function closeSearch() {
    setSearchOpen(false);
    searchToggleRef.current?.focus();
  }

  return (
    <div className={styles.workspace} data-view={selected ? "transcript" : "list"} ref={rootRef}>
      <div className={styles.listPane}>
        <SupervisedConversationList
          initial={initial}
          selectedId={selected?.conversationId ?? null}
          onSelect={open}
        />
      </div>

      {selected ? (
        <section className={styles.panel} aria-labelledby="supervised-transcript-heading" ref={panelRef}>
          <header className={styles.header}>
            <button type="button" className={styles.back} onClick={back} aria-label="Back to conversations">
              <ChevronLeft aria-hidden="true" />
              Back
            </button>
            <span className={styles.headerAvatars}>
              {selected.participants.map((participant) => (
                <TeamAvatar
                  key={participant.profileId}
                  name={participant.displayName?.trim() || "Unnamed member"}
                  initials={teamInitials(participant.displayName)}
                  avatarUrl={participant.avatarUrl?.trim() || null}
                  small
                />
              ))}
            </span>
            <h2
              id="supervised-transcript-heading"
              className={styles.title}
              ref={headingRef}
              tabIndex={-1}
            >
              {selected.participants.map((participant, index) => (
                <span className={styles.titlePerson} key={participant.profileId}>
                  {index > 0 ? (
                    <>
                      <span className={styles.titleSeparator} aria-hidden="true">↔</span>
                      {" "}<span className={styles.srOnly}>and</span>{" "}
                    </>
                  ) : null}
                  <span className={styles.titleName}>
                    {participant.displayName?.trim() || "Unnamed member"}
                  </span>
                  {participant.archived ? <span className={styles.archived}>Archived</span> : null}
                </span>
              ))}
            </h2>
            {detail.state === "ready" ? (
              <button
                type="button"
                ref={searchToggleRef}
                className={styles.searchToggle}
                aria-label={searchOpen ? "Close search" : "Search this conversation"}
                aria-expanded={searchOpen}
                onClick={(event) => {
                  // Like Back, the tail of a double tap is not a second decision.
                  if (event.detail > 1) return;
                  toggleSearch();
                }}
              >
                {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
              </button>
            ) : null}
            <span className={styles.readOnly}>
              <Eye aria-hidden="true" />
              Read-only
            </span>
          </header>

          {detail.state === "ready" && searchOpen ? (
            <SupervisedSearch
              key={`search-${selected.conversationId}`}
              conversationId={selected.conversationId}
              onClose={closeSearch}
            />
          ) : null}

          {detail.state === "ready" ? (
            <SupervisedTranscript key={selected.conversationId} initial={detail.page} />
          ) : detail.state === "loading" ? (
            <div className={styles.scroll}>
              <div className={styles.skeleton} role="status" aria-label="Loading conversation">
                <div className="skeleton-line skeleton-heading" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
              </div>
            </div>
          ) : (
            <div className={styles.scroll}>
              <DetailError code={detail.code} onRetry={() => open(selected)} />
            </div>
          )}
        </section>
      ) : (
        <div className={styles.placeholder}>
          <p className={styles.placeholderTitle}>Select a conversation to view it</p>
          <p>Transcripts open read-only.</p>
        </div>
      )}
    </div>
  );
}

function DetailError({ code, onRetry }: { code: ClientSafeError["code"]; onRetry: () => void }) {
  if (code === "NOT_FOUND") {
    return <p className={styles.notice} role="alert">This conversation is unavailable.</p>;
  }
  if (code === "PERMISSION_DENIED") {
    return <p className={styles.notice} role="alert">You don&apos;t have access to this view.</p>;
  }
  return (
    <div className={styles.notice} role="alert">
      <p>This conversation could not be loaded.</p>
      <button type="button" className="button-secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
