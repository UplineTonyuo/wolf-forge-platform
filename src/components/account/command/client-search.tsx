"use client";

import { FolderKanban, MessagesSquare, Search, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { clientSearchAction } from "../../../app/actions/client-search";
import {
  groupResults,
  MIN_QUERY_LENGTH,
  type ClientSearchKind,
  type ClientSearchResult,
} from "../../../domain/client-portal/search";
import { AttentionPill } from "../ui/attention-pill";
import { HeaderPanel, HeaderPanelAnchor } from "./header-panel";
import { useHeaderPanels } from "./header-panels";

/**
 * Client portal global search.
 *
 * Searches the account's own projects, conversations and services. Every query
 * runs server-side through clientSearchAction, which derives the account from
 * auth.uid() and reads through the existing RLS-scoped paths — nothing is
 * downloaded into the browser to be searched, and the browser never names a
 * company.
 *
 * The results panel is a header panel like every other, so it shares the
 * single-open manager: opening it closes notifications, services or quick
 * actions, and none of them can sit on top of it.
 */

/** Long enough to skip intermediate keystrokes, short enough to feel live. */
const DEBOUNCE_MS = 150;

const kindIcons: Record<ClientSearchKind, typeof FolderKanban> = {
  project: FolderKanban,
  message: MessagesSquare,
  service: ShoppingCart,
};

function ResultRow({
  result,
  active,
  onChoose,
  onHover,
  id,
}: {
  result: ClientSearchResult;
  active: boolean;
  onChoose: () => void;
  onHover: () => void;
  id: string;
}) {
  const Icon = kindIcons[result.kind];

  return (
    <li>
      <button
        type="button"
        id={id}
        role="option"
        aria-selected={active}
        className="search-result"
        data-active={active ? "true" : "false"}
        onPointerMove={onHover}
        onClick={onChoose}
      >
        <Icon aria-hidden={true} />
        <span className="search-result-copy">
          <strong>{result.title}</strong>
          <span>{result.subtitle}</span>
        </span>
        {result.tone ? (
          <AttentionPill tone={result.tone} label={result.subtitle.split(" · ").pop() ?? ""} />
        ) : null}
      </button>
    </li>
  );
}

export function ClientSearch() {
  const panels = useHeaderPanels();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [activeIndex, setActiveIndex] = useState(0);

  /*
   * Every request carries a sequence number and only the newest one is allowed
   * to write state. Typing "p", "po", "pod" can otherwise let the slower "p"
   * response land last and replace the results for "pod".
   */
  const requestSeq = useRef(0);

  const run = useCallback(async (query: string) => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;

    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setStatus("idle");
      return;
    }

    setStatus("searching");
    const response = await clientSearchAction(query);

    if (requestSeq.current !== seq) return;

    if (!response.ok) {
      setResults([]);
      setStatus("error");
      return;
    }

    setResults(response.results);
    setActiveIndex(0);
    setStatus("done");
  }, []);

  const searchable = value.trim().length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!searchable) {
      // Invalidate anything in flight so a late response cannot repopulate a
      // panel the client has already cleared. A ref bump, not state: below the
      // minimum the results are simply not read, so there is nothing to reset.
      requestSeq.current += 1;
      return;
    }

    const timer = setTimeout(() => void run(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, searchable, run]);

  /*
   * Results are derived rather than cleared. Below the minimum query length the
   * stored list is ignored entirely, so it can never be rendered stale and no
   * effect has to reach in and empty it.
   */
  const groups = searchable ? groupResults(results) : [];
  const flat = groups.flatMap((group) => group.results);
  const open = panels?.isOpen("search") ?? false;

  const choose = useCallback(
    (result: ClientSearchResult) => {
      panels?.close();
      setValue("");
      setResults([]);
      setStatus("idle");
      router.push(result.href);
    },
    [panels, router],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      panels?.close();
      inputRef.current?.blur();
      return;
    }

    if (flat.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % flat.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + flat.length) % flat.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const target = flat[activeIndex] ?? flat[0];
      if (target) choose(target);
    }
  }

  const showPanel = open && searchable;
  const activeId = flat[activeIndex] ? `client-search-option-${activeIndex}` : undefined;

  return (
    <HeaderPanelAnchor className="portal-command-search-anchor">
      <form
        className="portal-command-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const target = flat[activeIndex] ?? flat[0];
          if (target) choose(target);
        }}
      >
        <Search aria-hidden={true} />
        <input
          ref={inputRef}
          type="search"
          value={value}
          placeholder="Search projects, messages, services..."
          aria-label="Search projects, messages and services"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="client-search-results"
          aria-autocomplete="list"
          aria-activedescendant={showPanel ? activeId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            // Typing pins the panel: a hover-out must never pull it away from
            // someone mid-query.
            if (event.target.value.trim().length >= MIN_QUERY_LENGTH) panels?.pin("search");
          }}
          onFocus={() => panels?.cancelClose()}
          onKeyDown={onKeyDown}
        />
      </form>

      <HeaderPanel panel="search" label="Search results" width="wide">
        <div className="search-panel" id="client-search-results">
          {!searchable ? (
            <p className="chooser-empty">Keep typing to search.</p>
          ) : status === "error" ? (
            <p className="chooser-empty">Search is unavailable right now.</p>
          ) : groups.length === 0 ? (
            <p className="chooser-empty">
              {status === "searching"
                ? "Searching…"
                : `No results for “${value.trim()}”. Try a project reference, conversation, or service name.`}
            </p>
          ) : (
            <div role="listbox" aria-label="Search results">
              {groups.map((group) => (
                <section className="search-group" key={group.kind}>
                  <p className="chooser-caption">{group.label}</p>
                  <ul className="chooser-list">
                    {group.results.map((result) => {
                      const index = flat.indexOf(result);
                      return (
                        <ResultRow
                          key={`${result.kind}-${result.id}`}
                          id={`client-search-option-${index}`}
                          result={result}
                          active={index === activeIndex}
                          onHover={() => setActiveIndex(index)}
                          onChoose={() => choose(result)}
                        />
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </HeaderPanel>
    </HeaderPanelAnchor>
  );
}
