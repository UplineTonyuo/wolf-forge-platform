"use client";

import { Search } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { searchSupervisedConversationAction } from "../../app/actions/team-supervision";
import type {
  SupervisedMessageCursor,
  SupervisedMessageSearchResult,
} from "../../domain/team-supervision/projections";
import { parseTeamHighlightedSnippet } from "../../domain/team/formatting";
import { formatTeamMessageTime, formatTeamSearchResultDate } from "../../domain/team/projections";
import { teamSearchQueryMaxLength } from "../../domain/team/schema";
import type { ClientSafeError } from "../../lib/errors/application-error";
import styles from "./supervised-transcript.module.css";

type Found = {
  query: string;
  results: SupervisedMessageSearchResult[];
  cursor: SupervisedMessageCursor | null;
};

/**
 * Search inside the one open supervised conversation.
 *
 * Only a deliberate submit (Enter or the Search button) or an explicit "Load
 * more results" calls the action: each successful non-empty search writes one
 * SEARCH audit and spends the supervisor's search quota. Typing, focus,
 * clearing, an empty or blank submit and rerenders read nothing. The query
 * stays in this component's state: never in the URL, storage or logs.
 *
 * The workspace keys this by conversation, so switching or closing discards
 * the query and results and nothing reruns. A response that no longer belongs
 * to the current search (cleared, or superseded) is dropped.
 *
 * A result is a button that hands its message id to the workspace, which
 * alone reads the context window; this component never does. Selecting a
 * result never searches again.
 */
export function SupervisedSearch({
  conversationId,
  activeResultId,
  onSelectResult,
  onClose,
}: {
  conversationId: string;
  activeResultId: string | null;
  onSelectResult: (messageId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [pending, setPending] = useState<"search" | "more" | null>(null);
  const [error, setError] = useState<{ code: ClientSafeError["code"]; more: boolean } | null>(null);
  const requestRef = useRef<object | null>(null);

  function reset() {
    requestRef.current = null;
    setPending(null);
    setFound(null);
    setError(null);
  }

  async function run(searchQuery: string, cursor: SupervisedMessageCursor | null) {
    if (requestRef.current) return;
    const request = {};
    requestRef.current = request;
    setPending(cursor ? "more" : "search");
    setError(null);

    const result = await searchSupervisedConversationAction({
      conversationId,
      query: searchQuery,
      ...cursor,
    });

    if (requestRef.current !== request) return;
    requestRef.current = null;
    setPending(null);
    if (!result.ok) {
      setError({ code: result.error.code, more: Boolean(cursor) });
      if (!cursor) setFound(null);
      return;
    }
    const page = result.data;
    setFound((current) => ({
      query: searchQuery,
      results: cursor && current ? [...current.results, ...page.results] : page.results,
      cursor: page.hasMore ? page.nextCursor : null,
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestRef.current) return;
    if (!query.trim()) return reset();
    void run(query, null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const errorMessage =
    error?.code === "RATE_LIMITED"
      ? "Too many searches. Try again shortly."
      : error
        ? error.more
          ? "More results could not be loaded."
          : "Search could not be completed. Try again."
        : null;

  return (
    <div className={styles.search}>
      <form className={styles.searchForm} role="search" onSubmit={submit}>
        <label className={styles.srOnly} htmlFor="supervised-search-input">
          Search this conversation
        </label>
        <input
          id="supervised-search-input"
          className={styles.searchInput}
          type="search"
          value={query}
          maxLength={teamSearchQueryMaxLength}
          placeholder="Search this conversation"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value.trim()) reset();
          }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="button-secondary" disabled={pending !== null}>
          <Search aria-hidden="true" />
          Search
        </button>
      </form>

      <div className={styles.searchStatus} role="status">
        {pending === "search"
          ? "Searching…"
          : found && !error
            ? found.results.length === 0
              ? "No matching messages"
              : `${found.results.length}${found.cursor ? "+" : ""} matching ${found.results.length === 1 ? "message" : "messages"}`
            : ""}
      </div>
      {errorMessage ? (
        <p className={styles.searchError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      {found && found.results.length > 0 ? (
        <div className={styles.searchResults}>
          <ol aria-label="Search results">
            {found.results.map((result) => (
              <li key={result.messageId}>
                <button
                  type="button"
                  className={styles.searchResult}
                  data-result-id={result.messageId}
                  aria-current={activeResultId === result.messageId ? "true" : undefined}
                  onClick={(event) => {
                    // The tail of a double tap is not a second selection; keyboard reports 0.
                    if (event.detail > 1) return;
                    onSelectResult(result.messageId);
                  }}
                >
                  <span className={styles.groupHeader}>
                    <span className={styles.author}>
                      {result.author.displayName?.trim() || "Unnamed member"}
                    </span>
                    <time
                      className={styles.time}
                      dateTime={result.createdAt}
                      title={new Date(result.createdAt).toLocaleString()}
                      suppressHydrationWarning
                    >
                      {formatTeamSearchResultDate(result.createdAt)} · {formatTeamMessageTime(result.createdAt)}
                    </time>
                  </span>
                  <span className={styles.searchSnippet}>
                    {parseTeamHighlightedSnippet(result.snippet).map((segment, index) =>
                      segment.matched ? <mark key={index}>{segment.text}</mark> : segment.text,
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {found.cursor ? (
            <div className={styles.older}>
              <button
                type="button"
                className="button-secondary"
                disabled={pending !== null}
                aria-busy={pending === "more"}
                onClick={() => {
                  if (found.cursor) void run(found.query, found.cursor);
                }}
              >
                {pending === "more" ? "Loading…" : "Load more results"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
