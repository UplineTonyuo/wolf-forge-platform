"use client";

import { Search, X } from "lucide-react";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

const EMPTY_VALUES: string[] = [];

function findSuggestion(
  value: string,
  suggestions: string[],
) {
  if (!value) {
    return null;
  }

  const query =
    value.toLocaleLowerCase();

  const matches =
    suggestions.filter(
      (candidate) =>
        candidate
          .toLocaleLowerCase()
          .startsWith(query) &&
        candidate.length > value.length,
    );

  if (matches.length === 0) {
    return null;
  }

  /*
   * Prefer the completion that requires the fewest
   * additional characters. Alphabetical order is the
   * deterministic tie-breaker.
   */
  matches.sort(
    (left, right) => {
      const lengthDifference =
        left.length -
        right.length;

      if (lengthDifference !== 0) {
        return lengthDifference;
      }

      return left.localeCompare(
        right,
        undefined,
        {
          sensitivity: "base",
        },
      );
    },
  );

  return matches[0] ?? null;
}

export function FilterInput({
  label,
  initialValue = "",
  clearParamsOnSearch = EMPTY_VALUES,
  suggestions = EMPTY_VALUES,
  placeholder,
}: {
  label: string;
  initialValue?: string;
  clearParamsOnSearch?: string[];
  suggestions?: string[];
  /** Shown when the label is presented visually hidden, as in a filter toolbar. */
  placeholder?: string;
}) {
  const [
    value,
    setValue,
  ] = useState(initialValue);

  const pathname =
    usePathname();

  const params =
    useSearchParams();

  const router =
    useRouter();

  const suggestion =
    useMemo(
      () =>
        findSuggestion(
          value,
          suggestions,
        ),
      [
        suggestions,
        value,
      ],
    );

  const suggestionRemainder =
    suggestion
      ? suggestion.slice(
          value.length,
        )
      : "";

  useEffect(() => {
    const timer =
      window.setTimeout(
        () => {
          const next =
            new URLSearchParams(
              params.toString(),
            );

          if (value.trim()) {
            next.set(
              "q",
              value.trim(),
            );

            for (
              const key of
              clearParamsOnSearch
            ) {
              next.delete(key);
            }
          } else {
            next.delete("q");
          }

          const query = next.toString();


          const currentQuery = params.toString();


          if (query === currentQuery) {

            return;

          }

          router.replace(
            query
              ? `${pathname}?${query}`
              : pathname,
            {
              scroll: false,
            },
          );
        },
        150,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [
    clearParamsOnSearch,
    params,
    pathname,
    router,
    value,
  ]);

  function acceptSuggestion() {
    if (!suggestion) {
      return;
    }

    setValue(suggestion);
  }

  return (
    <label className="filter-control">
      <span>
        {label}
      </span>

      <div
        className={
          suggestion
            ? "filter-input-wrap has-suggestion"
            : "filter-input-wrap"
        }
      >
        <Search
          aria-hidden="true"
        />

        {suggestion ? (
          <div
            className="filter-autocomplete"
            aria-hidden="true"
          >
            <span className="filter-autocomplete-prefix">
              {value}
            </span>

            <span className="filter-autocomplete-suffix">
              {
                suggestionRemainder
              }
            </span>
          </div>
        ) : null}

        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) =>
            setValue(
              event.target.value,
            )
          }
          onKeyDown={(event) => {
            if (
              event.key !==
                "ArrowRight" ||
              !suggestion
            ) {
              return;
            }

            const input =
              event.currentTarget;

            if (
              input.selectionStart !==
                value.length ||
              input.selectionEnd !==
                value.length
            ) {
              return;
            }

            event.preventDefault();
            acceptSuggestion();
          }}
        />

        {value ? (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() =>
              setValue("")
            }
          >
            <X
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
    </label>
  );
}