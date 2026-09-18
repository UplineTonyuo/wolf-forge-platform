"use client";

import {
  Check,
  ChevronDown,
  LoaderCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { updateClientStatusAction } from "../../app/actions/clients";

const statusOptions = [
  {
    value: "contact",
    label: "Contact",
  },
  {
    value: "lead",
    label: "Lead",
  },
  {
    value: "client",
    label: "Client",
  },
  {
    value: "client_team",
    label: "Client Team",
  },
] as const;

type ClientStatus =
  (typeof statusOptions)[number]["value"];

function normalizeStatus(
  value: string,
): ClientStatus {
  return statusOptions.some(
    (option) => option.value === value,
  )
    ? (value as ClientStatus)
    : "contact";
}

function labelForStatus(
  status: ClientStatus,
) {
  return (
    statusOptions.find(
      (option) =>
        option.value === status,
    )?.label ?? "Contact"
  );
}

export function ClientStatusControl({
  companyId,
  status,
}: {
  companyId: string;
  status: string;
}) {
  const router = useRouter();

  const containerRef =
    useRef<HTMLDivElement>(null);

  const [currentStatus, setCurrentStatus] =
    useState<ClientStatus>(
      normalizeStatus(status),
    );

  const [lastStatus, setLastStatus] =
    useState(status);

  if (lastStatus !== status) {
    setLastStatus(status);
    setCurrentStatus(
      normalizeStatus(status),
    );
  }

  const [open, setOpen] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [pending, startTransition] =
    useTransition();

  useEffect(() => {
    const handlePointerDown = (
      event: MouseEvent,
    ) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      handlePointerDown,
    );

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handlePointerDown,
      );

      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, []);

  const chooseStatus = (
    nextStatus: ClientStatus,
  ) => {
    if (
      pending ||
      nextStatus === currentStatus
    ) {
      setOpen(false);
      return;
    }

    const previous =
      currentStatus;

    setCurrentStatus(nextStatus);
    setOpen(false);
    setError(null);

    startTransition(async () => {
      const result =
        await updateClientStatusAction(
          companyId,
          nextStatus,
        );

      if (!result.ok) {
        setCurrentStatus(previous);
        setError(result.error);
        return;
      }

      setCurrentStatus(
        normalizeStatus(
          result.status,
        ),
      );

      router.refresh();
    });
  };

  return (
    <div
      ref={containerRef}
      className="client-status-picker-v2"
    >
      <button
        type="button"
        className={
          open
            ? "client-status-trigger-v2 is-open"
            : "client-status-trigger-v2"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={() =>
          setOpen((value) => !value)
        }
      >
        <span
          className={`client-status-dot is-${currentStatus}`}
          aria-hidden="true"
        />

        <span className="client-status-trigger-label">
          {labelForStatus(
            currentStatus,
          )}
        </span>

        {pending ? (
          <LoaderCircle
            className="client-status-spinner-v2"
            aria-hidden="true"
          />
        ) : (
          <ChevronDown
            className="client-status-chevron-v2"
            aria-hidden="true"
          />
        )}
      </button>

      <div
        className={
          open
            ? "client-status-menu-v2 is-open"
            : "client-status-menu-v2"
        }
        role="menu"
        aria-hidden={!open}
      >
        {statusOptions.map(
          (option) => {
            const selected =
              option.value ===
              currentStatus;

            return (
              <button
                key={option.value}
                type="button"
                role="menuitem"
                tabIndex={
                  open ? 0 : -1
                }
                className={
                  selected
                    ? "client-status-option-v2 is-selected"
                    : "client-status-option-v2"
                }
                onClick={() =>
                  chooseStatus(
                    option.value,
                  )
                }
              >
                <span
                  className={`client-status-dot is-${option.value}`}
                  aria-hidden="true"
                />

                <span>
                  {option.label}
                </span>

                <Check
                  className="client-status-check-v2"
                  aria-hidden="true"
                />
              </button>
            );
          },
        )}
      </div>

      {error ? (
        <p
          className="client-status-error-v2"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
