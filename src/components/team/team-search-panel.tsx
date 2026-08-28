"use client";

import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { searchTeamConversationMessagesAction } from "../../app/actions/team-messages";
import {
  toTeamSearchResultViews,
  type TeamSearchResultView,
} from "../../domain/team/projections";
import { TeamAvatar } from "./team-avatar";
import styles from "./team-messages.module.css";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Conversation history search.
 *
 * Compact and anchored under the pane header — never a modal. Debounced
 * 250ms, and every stale answer is discarded by comparing against a request
 * counter, the same technique `GlobalSearch` already uses, so a fast typist
 * never sees an out-of-order result set.
 *
 * The query and results stay mounted the whole time the panel is open: a
 * result click calls `onJumpToResult` but never closes this panel, which is
 * what lets next/previous work without the employee re-opening search or
 * re-typing the query.
 */
export function TeamSearchPanel({
  open,
  conversationId,
  onClose,
  onJumpToResult,
}: {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onJumpToResult: (result: TeamSearchResultView) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamSearchResultView[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const requestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const onJumpToResultRef = useRef(onJumpToResult);
  useEffect(() => {
    onJumpToResultRef.current = onJumpToResult;
  }, [onJumpToResult]);

  /*
   * A fresh session per conversation, adjusted during render rather than in
   * an effect: opening search on a different thread must never show the
   * previous thread's query or results for even one frame.
   */
  const [sessionConversationId, setSessionConversationId] = useState(conversationId);
  if (open && conversationId !== sessionConversationId) {
    setSessionConversationId(conversationId);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    setError(null);
    setHasSearched(false);
  }

  /*
   * The spinner turns on the instant a non-empty keystroke lands, adjusted
   * here during render rather than in the debounce effect below.
   */
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    if (query.trim()) setLoading(true);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();

    if (!trimmed) {
      /*
       * Invalidates any in-flight request for the query just cleared, so a
       * slow answer that lands after the box was emptied cannot repopulate
       * results the employee already dismissed. The reset itself is deferred
       * to a microtask, the same clean shape as the debounced success path
       * below, rather than a direct setState call in the effect body.
       */
      requestRef.current += 1;
      void Promise.resolve().then(() => {
        setResults([]);
        setLoading(false);
        setError(null);
        setHasSearched(false);
      });
      return;
    }

    const requestId = ++requestRef.current;

    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await searchTeamConversationMessagesAction({
          conversationId,
          query: trimmed,
        });
        if (requestId !== requestRef.current) return;

        setLoading(false);
        setHasSearched(true);

        if (!result.ok) {
          setResults([]);
          setError(result.error);
          return;
        }

        const views = toTeamSearchResultViews(result.data.results);
        setResults(views);
        setActiveIndex(0);
        setError(null);
        if (views.length > 0) onJumpToResultRef.current(views[0]!);
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [conversationId, open, query]);

  if (!open) return null;

  function goTo(index: number) {
    if (results.length === 0) return;
    const next = ((index % results.length) + results.length) % results.length;
    setActiveIndex(next);
    onJumpToResult(results[next]!);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      /*
       * stopPropagation, not just preventDefault: the drawer itself listens
       * for Escape on `document` to close the WHOLE Team Messages surface.
       * Without stopping the native event here, closing search would also
       * cascade into closing the drawer behind it.
       */
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      goTo(activeIndex + (event.shiftKey ? -1 : 1));
    }
  }

  return (
    <div className={styles.searchPanel} role="search" aria-label="Search conversation">
      <div className={styles.searchPanelBar}>
        <Search className={styles.searchPanelIcon} size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          className={styles.searchPanelInput}
          type="text"
          value={query}
          placeholder="Search conversation"
          aria-label="Search conversation"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />

        {loading ? (
          <Loader2 className={styles.spin} size={14} aria-hidden="true" />
        ) : null}

        <div className={styles.searchPanelNav}>
          <button
            type="button"
            className={styles.searchNavButton}
            aria-label="Previous result"
            disabled={results.length === 0}
            onClick={() => goTo(activeIndex - 1)}
          >
            <ChevronUp aria-hidden="true" size={14} />
          </button>
          <span className={styles.searchNavCount}>
            {results.length > 0 ? `${activeIndex + 1} of ${results.length}` : hasSearched ? "0" : ""}
          </span>
          <button
            type="button"
            className={styles.searchNavButton}
            aria-label="Next result"
            disabled={results.length === 0}
            onClick={() => goTo(activeIndex + 1)}
          >
            <ChevronDown aria-hidden="true" size={14} />
          </button>
        </div>

        <button
          type="button"
          className={styles.searchPanelClose}
          aria-label="Close search"
          onClick={onClose}
        >
          <X aria-hidden="true" size={14} />
        </button>
      </div>

      {query.trim() ? (
        <div className={styles.searchResults} role="listbox">
          {error ? (
            <div className={styles.searchEmptyState}>{error}</div>
          ) : hasSearched && !loading && results.length === 0 ? (
            <div className={styles.searchEmptyState}>No matches in this conversation.</div>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={[
                  styles.searchResultRow,
                  index === activeIndex ? styles.searchResultRowActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => goTo(index)}
              >
                <TeamAvatar
                  name={result.authorName}
                  initials={result.authorInitials}
                  avatarUrl={result.authorAvatarUrl}
                  small
                />
                <span className={styles.searchResultBody}>
                  <span className={styles.searchResultMeta}>
                    <strong>{result.authorName}</strong>
                    <span>{result.dateLabel}</span>
                  </span>
                  <span className={styles.searchResultSnippet}>
                    &ldquo;
                    {result.segments.map((segment, segmentIndex) =>
                      segment.matched ? (
                        <mark key={segmentIndex}>{segment.text}</mark>
                      ) : (
                        <span key={segmentIndex}>{segment.text}</span>
                      ),
                    )}
                    &rdquo;
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
