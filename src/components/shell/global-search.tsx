"use client";

import {
  ArrowUpRight,
  Building2,
  FolderKanban,
  Hash,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";

import {
  useRouter,
} from "next/navigation";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  globalSearchAction,
  type GlobalSearchItem,
  type GlobalSearchKind,
} from "../../app/actions/global-search";

import styles from "./global-search.module.css";


function resultIcon(
  kind: GlobalSearchKind,
): ReactNode {

  if (
    kind === "client"
  ) {

    return (
      <Building2
        size={16}
        aria-hidden="true"
      />
    );
  }


  if (
    kind === "service"
  ) {

    return (
      <FolderKanban
        size={16}
        aria-hidden="true"
      />
    );
  }


  return (
    <Hash
      size={16}
      aria-hidden="true"
    />
  );
}


function resultTypeLabel(
  kind: GlobalSearchKind,
) {

  if (
    kind === "client"
  ) {
    return "CLIENT";
  }


  if (
    kind === "service"
  ) {
    return "SERVICE";
  }


  return "PROJECT";
}


function HighlightedTitle({
  title,
  query,
}: {
  title: string;
  query: string;
}) {

  const normalizedTitle =
    title.toLocaleLowerCase();

  const normalizedQuery =
    query
      .trim()
      .toLocaleLowerCase()
      .replace(
        /^#/,
        "",
      );


  if (!normalizedQuery) {
    return <>{title}</>;
  }


  const index =
    normalizedTitle.indexOf(
      normalizedQuery,
    );


  if (index < 0) {
    return <>{title}</>;
  }


  return (
    <>
      {title.slice(
        0,
        index,
      )}

      <mark>
        {title.slice(
          index,
          index +
            normalizedQuery.length,
        )}
      </mark>

      {title.slice(
        index +
          normalizedQuery.length,
      )}
    </>
  );
}


export function GlobalSearch() {

  const router =
    useRouter();

  const rootRef =
    useRef<HTMLDivElement>(
      null,
    );

  const inputRef =
    useRef<HTMLInputElement>(
      null,
    );

  const requestRef =
    useRef(0);

  const navigationTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);


  const [
    query,
    setQuery,
  ] = useState("");

  const [
    results,
    setResults,
  ] =
    useState<
      GlobalSearchItem[]
    >([]);

  const [
    open,
    setOpen,
  ] = useState(false);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const [
    activeIndex,
    setActiveIndex,
  ] = useState(0);

  const [
    leaving,
    setLeaving,
  ] = useState(false);

  const [
    lastQuery,
    setLastQuery,
  ] = useState(query);

  if (lastQuery !== query) {
    setLastQuery(query);

    if (query.trim()) {
      setOpen(true);
      setLoading(true);
      setError(null);
    } else {
      setResults([]);
      setLoading(false);
      setError(null);
      setActiveIndex(0);
    }
  }


  useEffect(() => {

    return () => {

      if (
        navigationTimerRef.current
      ) {

        clearTimeout(
          navigationTimerRef.current,
        );
      }
    };
  }, []);


  useEffect(() => {

    const wanted =
      query.trim();


    if (!wanted) {

      requestRef.current += 1;

      return;
    }


    const requestId =
      ++requestRef.current;


    const timer =
      window.setTimeout(
        async () => {

          const response =
            await globalSearchAction(
              wanted,
            );


          if (
            requestId !==
            requestRef.current
          ) {
            return;
          }


          if (
            response.ok
          ) {

            setResults(
              response.results,
            );

            setError(null);

          } else {

            setResults([]);
            setError(
              response.error,
            );
          }


          setLoading(false);
          setActiveIndex(0);
        },
        190,
      );


    return () => {
      window.clearTimeout(
        timer,
      );
    };

  }, [query]);


  useEffect(() => {

    function outside(
      event: PointerEvent,
    ) {

      if (
        rootRef.current &&
        !rootRef.current.contains(
          event.target as Node,
        )
      ) {

        setOpen(false);
      }
    }


    function escape(
      event: globalThis.KeyboardEvent,
    ) {

      if (
        event.key ===
        "Escape"
      ) {

        setOpen(false);
      }
    }


    document.addEventListener(
      "pointerdown",
      outside,
    );

    document.addEventListener(
      "keydown",
      escape,
    );


    return () => {

      document.removeEventListener(
        "pointerdown",
        outside,
      );

      document.removeEventListener(
        "keydown",
        escape,
      );
    };

  }, []);


  const firstResult =
    results[0] ??
    null;


  const completion =
    useMemo(() => {

      if (
        !firstResult ||
        !query.trim()
      ) {
        return "";
      }


      const typed =
        query.trim();

      const title =
        firstResult.title;


      if (
        !title
          .toLocaleLowerCase()
          .startsWith(
            typed.toLocaleLowerCase(),
          )
      ) {
        return "";
      }


      if (
        typed.length >=
        title.length
      ) {
        return "";
      }


      return title.slice(
        typed.length,
      );

    }, [
      firstResult,
      query,
    ]);


  function choose(
    result: GlobalSearchItem,
  ) {

    if (leaving) {
      return;
    }


    setLeaving(true);
    setOpen(false);


    navigationTimerRef.current =
      setTimeout(() => {

        router.push(
          result.href,
        );

        setLeaving(false);
        setQuery("");

      }, 125);
  }


  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {

    if (
      event.key ===
      "ArrowDown"
    ) {

      event.preventDefault();

      if (
        results.length === 0
      ) {
        return;
      }


      setOpen(true);

      setActiveIndex(
        (current) =>
          Math.min(
            current + 1,
            results.length - 1,
          ),
      );

      return;
    }


    if (
      event.key ===
      "ArrowUp"
    ) {

      event.preventDefault();

      if (
        results.length === 0
      ) {
        return;
      }


      setActiveIndex(
        (current) =>
          Math.max(
            current - 1,
            0,
          ),
      );

      return;
    }


    if (
      event.key ===
      "Tab" &&
      completion &&
      firstResult
    ) {

      event.preventDefault();

      setQuery(
        firstResult.title,
      );

      return;
    }


    if (
      event.key ===
      "Enter" &&
      open &&
      results[
        activeIndex
      ]
    ) {

      event.preventDefault();

      choose(
        results[
          activeIndex
        ],
      );

      return;
    }


    if (
      event.key ===
      "Escape"
    ) {

      event.preventDefault();

      setOpen(false);
    }
  }


  const panelVisible =
    open &&
    query.trim().length >
      0;


  return (
    <div
      ref={rootRef}
      className={
        styles.root
      }
    >
      <div
        className={`${styles.searchShell} ${
          panelVisible
            ? styles.searchShellOpen
            : ""
        }`}
      >
        <Search
          className={
            styles.searchIcon
          }
          size={17}
          aria-hidden="true"
        />

        <div
          className={
            styles.inputArea
          }
        >
          {completion ? (
            <div
              className={
                styles.completion
              }
              aria-hidden="true"
            >
              <span>
                {query.trim()}
              </span>

              <em>
                {completion}
              </em>
            </div>
          ) : null}


          <input
            ref={inputRef}
            aria-label="Global search"
            placeholder="Search"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onFocus={() => {

              if (
                query.trim()
              ) {

                setOpen(true);
              }
            }}
            onChange={(
              event,
            ) => {

              setQuery(
                event.target.value,
              );

              setOpen(true);
            }}
            onKeyDown={
              handleKeyDown
            }
          />
        </div>


        {loading ? (
          <LoaderCircle
            className={
              styles.loadingIcon
            }
            size={15}
            aria-hidden="true"
          />
        ) : query ? (
          <button
            type="button"
            className={
              styles.clearButton
            }
            aria-label="Clear search"
            onClick={() => {

              setQuery("");
              setResults([]);
              setOpen(false);

              inputRef.current?.focus();
            }}
          >
            <X
              size={14}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>


      <section
        className={`${styles.panel} ${
          panelVisible
            ? styles.panelOpen
            : ""
        } ${
          leaving
            ? styles.panelLeaving
            : ""
        }`}
        aria-hidden={
          !panelVisible
        }
        aria-label="Global search results"
      >
        <div
          className={
            styles.goldLine
          }
          aria-hidden="true"
        />


        <header
          className={
            styles.panelHeader
          }
        >
          <div>

            <span>
              SEARCH WOLF FORGE
            </span>
          </div>

          {loading ? (
            <div
              className={
                styles.typing
              }
              aria-label="Searching"
            >
              <span />
              <span />
              <span />
            </div>
          ) : (
            <small>
              {results.length}
              {" "}
              {results.length ===
              1
                ? "result"
                : "results"}
            </small>
          )}
        </header>


        <div
          className={
            styles.results
          }
          role="listbox"
        >
          {loading &&
          results.length ===
            0 ? (
            <div
              className={
                styles.searchingState
              }
            >
              <Search
                size={18}
                aria-hidden="true"
              />

              <strong>
                Searching
              </strong>

              <span>
                Looking across clients,
                projects, numbers and
                services.
              </span>
            </div>
          ) : error ? (
            <div
              className={
                styles.searchingState
              }
            >
              <strong>
                Search unavailable
              </strong>

              <span>
                {error}
              </span>
            </div>
          ) : results.length ===
            0 ? (
            <div
              className={
                styles.searchingState
              }
            >
              <Search
                size={18}
                aria-hidden="true"
              />

              <strong>
                No match
              </strong>

              <span>
                Try a client name,
                project title, service,
                or project number.
              </span>
            </div>
          ) : (
            results.map(
              (
                result,
                index,
              ) => {

                const active =
                  index ===
                  activeIndex;

                return (
                  <button
                    key={`${result.kind}:${result.id}`}
                    type="button"
                    role="option"
                    aria-selected={
                      active
                    }
                    className={`${styles.resultRow} ${
                      active
                        ? styles.resultRowActive
                        : ""
                    }`}
                    style={{
                      "--result-index":
                        index,
                    } as React.CSSProperties}
                    onMouseEnter={() =>
                      setActiveIndex(
                        index,
                      )
                    }
                    onClick={() =>
                      choose(
                        result,
                      )
                    }
                  >
                    <span
                      className={
                        styles.resultIcon
                      }
                    >
                      {resultIcon(
                        result.kind,
                      )}
                    </span>

                    <span
                      className={
                        styles.resultCopy
                      }
                    >
                      <span
                        className={
                          styles.resultType
                        }
                      >
                        {resultTypeLabel(
                          result.kind,
                        )}
                      </span>

                      <strong>
                        <HighlightedTitle
                          title={
                            result.title
                          }
                          query={
                            query
                          }
                        />
                      </strong>

                      <small>
                        {
                          result.subtitle
                        }
                      </small>
                    </span>

                    <ArrowUpRight
                      className={
                        styles.resultArrow
                      }
                      size={15}
                      aria-hidden="true"
                    />
                  </button>
                );
              },
            )
          )}
        </div>


        <footer
          className={
            styles.footer
          }
        >
          <span>
            <kbd>{"\u2191"}</kbd>
            <kbd>{"\u2193"}</kbd>
            navigate
          </span>

          <span>
            <kbd>Enter</kbd>
            open
          </span>

          {completion ? (
            <span>
              <kbd>Tab</kbd>
              complete
            </span>
          ) : null}

        </footer>
      </section>
    </div>
  );
}
