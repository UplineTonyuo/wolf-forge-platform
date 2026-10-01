"use client";

import { ArrowLeft, ChevronLeft, Eye, MessagesSquare, Search, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  getSupervisedConversationAction,
  getSupervisedMessageWindowAction,
  listSupervisedConversationsAction,
  type TeamSupervisionActionResult,
} from "../../app/actions/team-supervision";
import {
  groupSupervisedConversationsByEmployee,
  type SupervisedConversationPage,
  type SupervisedConversationSummary,
  type SupervisedMessage,
  type SupervisedTranscriptPage,
} from "../../domain/team-supervision/projections";
import type { ClientSafeError } from "../../lib/errors/application-error";
import {
  Avatar,
  participantName,
  peopleLabel,
  SupervisedEmployeeList,
  SupervisedListState,
  SupervisedPartnerList,
} from "./supervised-conversation-list";
import { SupervisedSearch } from "./supervised-search";
import { SupervisedContextWindow, SupervisedTranscript } from "./supervised-transcript";
import styles from "./supervised-transcript.module.css";

/** Below this the transcript replaces the lists; matches the CSS three-pane split. */
const stackedQuery = "(max-width: 1199px)";
/** Below this employees and their conversations also take turns. */
const phoneQuery = "(max-width: 1023px)";

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

const accessDeniedPage: TeamSupervisionActionResult<SupervisedConversationPage> = {
  ok: false,
  error: { code: "PERMISSION_DENIED", message: "The operation failed." },
};

function isLostAccessCode(code: ClientSafeError["code"]): boolean {
  return code === "PERMISSION_DENIED" || code === "NOT_FOUND";
}

/**
 * All Conversations, employee first: employees, the selected employee's direct
 * conversations, and at most one supervised transcript.
 *
 * Employees are grouped from the list page already in hand, so choosing one
 * reads nothing and has nothing to load. Choosing a different employee closes
 * the open transcript, so another employee's conversation is never left on
 * screen. On phones the three panes take turns; below the three-pane split the
 * transcript replaces both lists.
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
  const [conversationPage, setConversationPage] = useState(initial);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  // Phones only: the employee's conversations are showing instead of the employees.
  const [browsing, setBrowsing] = useState(false);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const loadingMoreRef = useRef(false);
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
  const employeeHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);

  function lostAccess() {
    activeRef.current = null;
    jumpRef.current = null;
    restoreRef.current = null;
    setSelected(null);
    setDetail({ state: "error", code: "PERMISSION_DENIED" });
    setSearchOpen(false);
    setJump(null);
    setConversationPage(accessDeniedPage);
  }

  function handleReadFailure(code: ClientSafeError["code"]): boolean {
    if (!isLostAccessCode(code)) return false;
    lostAccess();
    return true;
  }

  // Leaving a context window puts the retained transcript back where it was.
  useLayoutEffect(() => {
    const restore = restoreRef.current;
    if (jump || !restore) return;
    restoreRef.current = null;
    const scroller = panelRef.current?.querySelector<HTMLElement>("[data-transcript]");
    if (scroller) scroller.scrollTop = restore.transcript;
    window.scrollTo?.(0, restore.page);
  }, [jump]);

  // Replacing the list page on access loss unmounts its local metadata cache.
  // The original server-provided page is never rendered again in this workspace.
  if (!conversationPage.ok || conversationPage.data.conversations.length === 0) {
    return <SupervisedListState initial={conversationPage} />;
  }

  const { conversations, nextCursor } = conversationPage.data;
  const employees = groupSupervisedConversationsByEmployee(conversations);
  // Nothing is chosen until a click, so the first employee stands in.
  const employee = employees.find((item) => item.participant.profileId === employeeId) ?? employees[0]!;
  const query = employeeQuery.trim().toLocaleLowerCase();
  const shownEmployees = query
    ? employees.filter(({ participant }) => participantName(participant).toLocaleLowerCase().includes(query))
    : employees;
  const view = selected ? "transcript" : browsing ? "conversations" : "employees";

  function chooseEmployee(profileId: string) {
    setBrowsing(true);
    if (profileId !== employee.participant.profileId) {
      setEmployeeId(profileId);
      // Another employee's transcript must not stay on screen.
      if (activeRef.current) closeConversation();
    }
    if (window.matchMedia?.(phoneQuery).matches) {
      requestAnimationFrame(() => employeeHeadingRef.current?.focus());
    }
  }

  function backToEmployees() {
    setBrowsing(false);
    requestAnimationFrame(() =>
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-employee-id="${employee.participant.profileId}"]`)
        ?.focus(),
    );
  }

  // One keyset page at a time. No retry loop: a failure waits for another click.
  async function loadMore() {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);

    const result = await listSupervisedConversationsAction(nextCursor);

    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!result.ok) {
      if (handleReadFailure(result.error.code)) return;
      setLoadMoreFailed(true);
      return;
    }
    setConversationPage((current) =>
      current.ok
        ? {
            ok: true,
            data: {
              conversations: [...current.data.conversations, ...result.data.conversations],
              nextCursor: result.data.nextCursor,
            },
          }
        : current,
    );
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
    if (!result.ok && handleReadFailure(result.error.code)) return;
    active.failed = !result.ok;
    setDetail(
      result.ok
        ? { state: "ready", page: result.data, checkedAt: new Date().toISOString() }
        : { state: "error", code: result.error.code },
    );
  }

  /** Forgets the transcript; a pending open is dropped when it lands. */
  function closeConversation() {
    activeRef.current = null;
    setSelected(null);
    setDetail({ state: "loading" });
    setSearchOpen(false);
    leaveJump();
  }

  function back() {
    const id = activeRef.current?.id;
    closeConversation();
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
    if (!result.ok && handleReadFailure(result.error.code)) return;
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
    const unavailable = result.ok;
    active.failed = !unavailable;
    setJump({ targetId, state: unavailable ? "unavailable" : "failed" });
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

  // The selected employee reads first: "William ↔ Licaros" under William.
  const pair = selected
    ? selected.participants[1].profileId === employee.participant.profileId
      ? [selected.participants[1], selected.participants[0]]
      : selected.participants
    : [];

  return (
    <div className={styles.workspace} data-view={view} ref={rootRef}>
      <div className={styles.employeePane}>
        <div className={`${styles.paneHeader} ${styles.employeeTitle}`}>
          <h2 className={styles.paneTitle}>
            Employees <span className={styles.paneCount}>{employees.length}</span>
          </h2>
        </div>
        <div className={styles.filterRow}>
          <label className={styles.filter}>
            <Search aria-hidden="true" />
            <span className={styles.srOnly}>Search employees</span>
            <input
              type="search"
              value={employeeQuery}
              placeholder="Search employees"
              autoComplete="off"
              onChange={(event) => setEmployeeQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        {shownEmployees.length ? (
          <SupervisedEmployeeList
            employees={shownEmployees}
            selectedId={employee.participant.profileId}
            onSelect={chooseEmployee}
          />
        ) : (
          <p className={styles.paneEmpty}>No employees match.</p>
        )}
        {nextCursor ? (
          <div className={styles.more}>
            {/* Counts cover loaded conversations only, so say so while more exist. */}
            <p>Counts include loaded conversations only.</p>
            <button
              type="button"
              className="button-secondary"
              onClick={loadMore}
              disabled={loadingMore}
              aria-busy={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
            {loadMoreFailed ? (
              <p className={styles.moreError} role="alert">
                More conversations could not be loaded.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.conversationPane}>
        <div className={`${styles.paneHeader} ${styles.employeeHeader}`}>
          <button type="button" className={styles.back} onClick={backToEmployees} aria-label="Back to employees">
            <ChevronLeft aria-hidden="true" />
            Employees
          </button>
          <Avatar participant={employee.participant} small={false} />
          <div className={styles.employeeIdentity}>
            <h2 className={styles.employeeName} ref={employeeHeadingRef} tabIndex={-1}>
              {participantName(employee.participant)}
            </h2>
            <p className={styles.paneMeta}>
              {employee.participant.archived ? "Archived · " : null}
              {peopleLabel(employee.partnerCount)}
            </p>
          </div>
        </div>
        {/* Keyed so a new employee's rows fade in rather than morph from the last. */}
        <div className={styles.paneBody} key={employee.participant.profileId}>
          <SupervisedPartnerList
            employee={employee}
            selectedId={selected?.conversationId ?? null}
            onSelect={open}
          />
        </div>
      </div>

      {selected ? (
        <section className={styles.panel} aria-labelledby="supervised-transcript-heading" ref={panelRef}>
          <header className={styles.header}>
            <button type="button" className={styles.back} onClick={back} aria-label="Back to conversations">
              <ChevronLeft aria-hidden="true" />
              Conversations
            </button>
            <span className={styles.headerAvatars}>
              {pair.map((participant) => (
                <Avatar key={participant.profileId} participant={participant} />
              ))}
            </span>
            <h2
              id="supervised-transcript-heading"
              className={styles.title}
              ref={headingRef}
              tabIndex={-1}
            >
              {pair.map((participant, index) => (
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
              <span className={styles.readOnlyLabel}>Read-only</span>
            </span>
          </header>

          {detail.state === "ready" && searchOpen ? (
            <SupervisedSearch
              key={`search-${selected.conversationId}`}
              conversationId={selected.conversationId}
              activeResultId={jump?.targetId ?? null}
              onSelectResult={jumpTo}
              onClose={closeSearch}
              onReadFailure={handleReadFailure}
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
                  <MessageSkeleton label="Loading message context" />
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
              onReadFailure={handleReadFailure}
            />
          ) : detail.state === "loading" ? (
            <div className={styles.scroll}>
              <MessageSkeleton label="Loading conversation" />
            </div>
          ) : (
            <div className={styles.scroll}>
              <DetailError code={detail.code} onRetry={() => open(selected)} />
            </div>
          )}
        </section>
      ) : (
        <div className={styles.placeholder}>
          <MessagesSquare aria-hidden="true" />
          <p className={styles.placeholderTitle}>Select a conversation to view it</p>
          <p>Transcripts open read-only.</p>
        </div>
      )}
    </div>
  );
}

/** Line widths per message group, in the transcript's own author-then-text shape. */
const skeletonGroups = [["62%", "38%"], ["74%"], ["48%", "66%"], ["56%"], ["70%", "30%"]];

/**
 * The transcript loading shape: author groups in the same single column, one
 * shared pulse on the whole block, no text. The header above stays real.
 */
function MessageSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      <div className={styles.skeletonBody} aria-hidden="true">
        {skeletonGroups.map((lines, group) => (
          <div className={styles.skeletonGroup} key={group}>
            <span className={styles.skeletonAvatar} />
            <span className={styles.skeletonLines}>
              <span className={styles.skeletonBar} style={{ width: group % 2 ? 88 : 116 }} />
              {lines.map((width, line) => (
                <span className={`${styles.skeletonBar} ${styles.skeletonText}`} style={{ width }} key={line} />
              ))}
            </span>
          </div>
        ))}
      </div>
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
