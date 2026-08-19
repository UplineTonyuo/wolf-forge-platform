"use client";

/* WF TICKET OPERATION SELECT */

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import styles from "./tickets.module.css";

type TicketOperationSelectProps =
  Omit<
    SelectHTMLAttributes<HTMLSelectElement>,
    "children"
  > & {
    children: ReactNode;
  };

type SelectOption = {
  value: string;
  label: string;
  disabled: boolean;
};

function nodeText(
  node: ReactNode,
): string {
  if (
    typeof node === "string" ||
    typeof node === "number"
  ) {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node
      .map(nodeText)
      .join("");
  }

  if (
    isValidElement<{
      children?: ReactNode;
    }>(node)
  ) {
    return nodeText(
      node.props.children,
    );
  }

  return "";
}

function collectOptions(
  children: ReactNode,
): SelectOption[] {
  const options: SelectOption[] =
    [];

  function walk(
    nodes: ReactNode,
  ) {
    Children.forEach(
      nodes,
      (node) => {
        if (
          !isValidElement<{
            value?: string | number;
            disabled?: boolean;
            children?: ReactNode;
          }>(node)
        ) {
          return;
        }

        if (
          node.type ===
          "option"
        ) {
          options.push({
            value:
              node.props.value ===
              undefined
                ? ""
                : String(
                    node.props.value,
                  ),
            label:
              nodeText(
                node.props.children,
              ),
            disabled:
              Boolean(
                node.props.disabled,
              ),
          });

          return;
        }

        if (
          node.type ===
          Fragment
        ) {
          walk(
            node.props.children,
          );
        }
      },
    );
  }

  walk(children);

  return options;
}

function normalizedValue(
  value:
    | string
    | number
    | readonly string[]
    | undefined,
): string {
  if (
    Array.isArray(value)
  ) {
    return String(
      value[0] ?? "",
    );
  }

  return value === undefined
    ? ""
    : String(value);
}

export function TicketOperationSelect({
  children,
  value,
  defaultValue,
  disabled,
  onChange,
  className: _className,
  "aria-label": ariaLabel,
  ...rest
}: TicketOperationSelectProps) {
  const rootRef =
    useRef<HTMLDivElement>(
      null,
    );

  const selectRef =
    useRef<HTMLSelectElement>(
      null,
    );

  const menuId =
    useId();

  const instanceId =
    useId();

  const [
    open,
    setOpen,
  ] =
    useState(false);

  const options =
    useMemo(
      () =>
        collectOptions(
          children,
        ),
      [children],
    );

  const currentValue =
    value !== undefined
      ? normalizedValue(value)
      : normalizedValue(
          defaultValue,
        );

  const selected =
    options.find(
      (option) =>
        option.value ===
        currentValue,
    ) ??
    options[0];

  useEffect(
    () => {
      function outside(
        event: MouseEvent,
      ) {
        if (
          !rootRef.current?.contains(
            event.target as Node,
          )
        ) {
          setOpen(false);
        }
      }

      function escape(
        event: KeyboardEvent,
      ) {
        if (
          event.key ===
          "Escape"
        ) {
          setOpen(false);
        }
      }

      function anotherOpened(
        event: Event,
      ) {
        const detail =
          (
            event as CustomEvent<string>
          ).detail;

        if (
          detail !==
          instanceId
        ) {
          setOpen(false);
        }
      }

      document.addEventListener(
        "mousedown",
        outside,
      );

      document.addEventListener(
        "keydown",
        escape,
      );

      window.addEventListener(
        "wf-ticket-operation-select-open",
        anotherOpened,
      );

      return () => {
        document.removeEventListener(
          "mousedown",
          outside,
        );

        document.removeEventListener(
          "keydown",
          escape,
        );

        window.removeEventListener(
          "wf-ticket-operation-select-open",
          anotherOpened,
        );
      };
    },
    [instanceId],
  );

  function toggle() {
    if (disabled) {
      return;
    }

    if (!open) {
      window.dispatchEvent(
        new CustomEvent(
          "wf-ticket-operation-select-open",
          {
            detail:
              instanceId,
          },
        ),
      );
    }

    setOpen(
      (current) =>
        !current,
    );
  }

  function choose(
    nextValue: string,
  ) {
    const option =
      options.find(
        (candidate) =>
          candidate.value ===
          nextValue,
      );

    if (
      disabled ||
      option?.disabled
    ) {
      return;
    }

    const select =
      selectRef.current;

    if (!select) {
      return;
    }

    select.value =
      nextValue;

    select.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true,
        },
      ),
    );

    setOpen(false);
  }

  const triggerLabel =
    selected?.label ||
    "Select";

  return (
    <div
      ref={rootRef}
      className={
        styles.filterDropdown
      }
      data-open={
        open
          ? "true"
          : "false"
      }
    >
      <select
        {...rest}
        ref={selectRef}
        value={value}
        defaultValue={
          defaultValue
        }
        disabled={disabled}
        onChange={onChange}
        aria-label={
          ariaLabel
        }
        className={
          styles.operationNativeSelect
        }
        tabIndex={-1}
      >
        {children}
      </select>

      <button
        type="button"
        className={
          styles.filterTrigger
        }
        aria-label={
          ariaLabel
            ? `${ariaLabel}: ${triggerLabel}`
            : triggerLabel
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={
          menuId
        }
        disabled={disabled}
        onClick={toggle}
      >
        <span>
          {triggerLabel}
        </span>

        <span
          aria-hidden="true"
          className={
            styles.filterChevron
          }
        />
      </button>

      <div
        id={menuId}
        className={
          styles.filterMenu
        }
        role="listbox"
        aria-label={
          ariaLabel
        }
        aria-hidden={
          !open
        }
      >
        {options.map(
          (option) => {
            const active =
              option.value ===
              currentValue;

            return (
              <button
                key={
                  option.value
                }
                type="button"
                role="option"
                aria-selected={
                  active
                }
                className={
                  styles.filterOption
                }
                data-active={
                  active
                    ? "true"
                    : "false"
                }
                disabled={
                  option.disabled
                }
                tabIndex={
                  open
                    ? 0
                    : -1
                }
                onClick={() =>
                  choose(
                    option.value,
                  )
                }
              >
                {
                  option.label
                }
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}