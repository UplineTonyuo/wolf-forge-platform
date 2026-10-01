"use client";

import { ArrowLeft, ChevronLeft, Eye, Search, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  getSupervisedConversationAction,
  getSupervisedMessageWindowAction,
  type TeamSupervisionActionResult,
} from "../../app/actions/team-supervision";
import type {
  SupervisedConversationPage,
  SupervisedConversationSummary,
  SupervisedMessage,
  SupervisedTranscriptPage,
} from "../../domain/team-supervision/projections";
import type { ClientSafeError } from "../../lib/errors/application-error";
import { teamInitials } from "../../domain/team/projections";
import { TeamAvatar } from "../team/team-avatar";
import { SupervisedConversationList } from "./supervised-conversation-list";
import { SupervisedSearch } from "./supervised-search";
import { SupervisedContextWindow, SupervisedTranscript } from "./supervised-transcript";
import styles from "./supervised-transcript.module.css";

/** Below this the list and the transcript take turns; matches the CSS split. */
const stackedQuery = "(max-width: 1023px)";

type Detail =
  | { state: "loading" }
  | { state: "ready"; page: SupervisedTranscriptPage; checkedAt: string }
  | { state: "error"; code: ClientSafeError["code"] };

type Jump =
  | { targetId: string; state: "loading" }
  | {
      targetId: string;
      state: "ready";
      messages: SupervisedMessage[];
      hasMoreBefore: boolean;
      hasMoreAfter: boolean;
    }
  | { targetId: string; state: "unavailable" | "failed" };

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
 *
 * A search result opens a bounded window around that message only when it is
 * activated: one activation, one window action, one PAGE audit. Re-activating
 * the shown or loading result does nothing and a superseded response is
 * dropped. The loaded transcript stays mounted (hidden) meanwhile, so "Return
 * to conversation" restores it, scroll included, without another read.
 */
export function SupervisedConversationsWorkspace({
  initial,
}: {
  initial: TeamSupervisionActionResult<SupervisedConversationPage>;
}) {
  const [selected, setSelected] = useState<SupervisedConversationSummary | null>(null);
  const [detail, setDetail] = useState<Detail>({ state: "loading" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [jump, setJump] = useState<Jump | null>(null);
  const activeRef = useRef<{ id: string; failed: boolean } | null>(null);
  const jumpRef = useRef<{ targetId: string; failed: boolean } | null>(null);
  const restoreRef = useRef<{ page: number; transcript: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);

  // Leaving a context window puts the retained transcript back where it was.
  useLayoutEffect(() => {
    const restore = restoreRef.current;
    if (jump || !restore) return;
    restoreRef.current = null;
    const scroller = panelRef.current?.querySelector<HTMLElement>("[data-transcript]");
    if (scroller) scroller.scrollTop = restore.transcript;
    window.scrollTo?.(0, restore.page);
  }, [jump]);

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
    leaveJump();

    // On narrow screens the row disappears under the transcript; move focus with it.
    if (window.matchMedia?.(stackedQuery).matches) {
      requestAnimationFrame(() => headingRef.current?.focus());
    }

    const result = await getSupervisedConversationAction({ conversationId: id });

    if (activeRef.current !== active) return;
    active.failed = !result.ok;
    setDetail(
      result.ok
        ? { state: "ready", page: result.data, checkedAt: new Date().toISOString() }
        : { state: "error", code: result.error.code },
    );
  }

  function back() {
    const id = activeRef.current?.id;
    activeRef.current = null;
    setSelected(null);
    setDetail({ state: "loading" });
    setSearchOpen(false);
    leaveJump();
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(`[data-conversation-id="${id}"]`)?.focus(),
    );
  }

  function leaveJump() {
    jumpRef.current = null;
    restoreRef.current = null;
    setJump(null);
  }

  async function jumpTo(targetId: string) {
    const conversation = activeRef.current;
    if (!conversation || (jumpRef.current?.targetId === targetId && !jumpRef.current.failed)) return;
    const active = { targetId, failed: false };
    if (!jumpRef.current) {
      const scroller = panelRef.current?.querySelector<HTMLElement>("[data-transcript]");
      restoreRef.current = { page: window.scrollY, transcript: scroller?.scrollTop ?? 0 };
    }
    jumpRef.current = active;
    setJump({ targetId, state: "loading" });

    const result = await getSupervisedMessageWindowAction({
      conversationId: conversation.id,
      targetMessageId: targetId,
    });

    if (jumpRef.current !== active) return;
    if (result.ok && result.data.found) {
      setJump({
        targetId,
        state: "ready",
        messages: result.data.messages,
        hasMoreBefore: result.data.hasMoreBefore,
        hasMoreAfter: result.data.hasMoreAfter,
      });
      return;
    }
    // Missing, foreign and ineligible targets all read as one unavailable state.
    const unavailable = result.ok || result.error.code === "NOT_FOUND";
    active.failed = !unavailable;
    setJump({ targetId, state: unavailable ? "unavailable" : "failed" });
  }

  // A deliberate refresh found the conversation unavailable or the view
  // forbidden: drop the transcript, search and window rather than keep showing
  // privileged content as current. Opening the row again is a new read.
  function lostAccess(code: ClientSafeError["code"]) {
    if (activeRef.current) activeRef.current.failed = true;
    setSearchOpen(false);
    leaveJump();
    setDetail({ state: "error", code });
  }

  function returnToConversation() {
    const targetId = jumpRef.current?.targetId;
    jumpRef.current = null;
    setJump(null);
    requestAnimationFrame(() =>
      (
        panelRef.current?.querySelector<HTMLElement>(`[data-result-id="${targetId}"]`) ?? headingRef.current
      )?.focus({ preventScroll: true }),
    );
  }

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false);
      leaveJump();
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
    leaveJump();
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
              activeResultId={jump?.targetId ?? null}
              onSelectResult={jumpTo}
              onClose={closeSearch}
            />
          ) : null}

          {detail.state === "ready" && jump ? (
            <>
              <div className={styles.contextBar}>
                <p>Search result in context</p>
                <button type="button" className={styles.contextReturn} onClick={returnToConversation}>
                  <ArrowLeft aria-hidden="true" />
                  Return to conversation
                </button>
              </div>
              {jump.state === "ready" ? (
                <SupervisedContextWindow
                  key={jump.targetId}
                  messages={jump.messages}
                  targetId={jump.targetId}
                  hasMoreBefore={jump.hasMoreBefore}
                  hasMoreAfter={jump.hasMoreAfter}
                />
              ) : jump.state === "loading" ? (
                <div className={styles.scroll}>
                  <div className={styles.skeleton} role="status" aria-label="Loading message context">
                    <div className="skeleton-line" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line" />
                  </div>
                </div>
              ) : (
                <div className={styles.scroll}>
                  {jump.state === "unavailable" ? (
                    <p className={styles.notice} role="alert">This message is unavailable.</p>
                  ) : (
                    <div className={styles.notice} role="alert">
                      <p>This message could not be loaded.</p>
                      <button type="button" className="button-secondary" onClick={() => jumpTo(jump.targetId)}>
                        Try again
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}

          {detail.state === "ready" ? (
            <SupervisedTranscript
              key={selected.conversationId}
              initial={detail.page}
              checkedAt={detail.checkedAt}
              hidden={jump !== null}
              onLostAccess={lostAccess}
            />
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
