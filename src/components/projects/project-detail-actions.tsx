"use client";

import {
  ChevronRight,
  Archive,
  ArrowLeft,
  Check,
  CircleCheckBig,
  PencilLine,
  Plus,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  archiveProjectAction,
  assignProjectAction,
  changeProjectStatusAction,
} from "../../app/actions/orders";

import type {
  ProjectBulkResult,
} from "../../domain/orders/bulk";

import {
  projectStatusLabels,
  type ProjectCapabilities,
} from "../../domain/orders/projections";

import {
  orderStatuses,
  type OrderStatus,
} from "../../domain/orders/schema";

import type {
  ProjectOption,
} from "./projects-workspace";

import styles from "./project-detail-actions.module.css";


type LauncherView =
  | "menu"
  | "assign"
  | "status"
  | "archive";


const closeDurationMs = 190;


function statusHint(
  status: OrderStatus,
) {
  const value =
    String(status);

  switch (value) {
    case "pending":
      return "Ready to begin";

    case "submitted":
      return "Submitted for review";

    case "working":
      return "Actively in progress";

    case "waiting_reply":
    case "waiting_on_client":
      return "Waiting for client response";

    case "pending_update":
    case "needs_update":
      return "Needs an internal update";

    case "complete":
      return "Finished and delivered";

    case "canceled":
    case "cancelled":
      return "Stopped or no longer active";

    default:
      return "Workflow status";
  }
}


export function ProjectDetailActions({
  orderId,
  status,
  assigneeId,
  people,
  capabilities,
}: {
  orderId: string;
  status: OrderStatus;
  assigneeId: string | null;
  people: ProjectOption[];
  capabilities: ProjectCapabilities;
}) {
  const router = useRouter();

  const [
    mounted,
    setMounted,
  ] = useState(false);

  const [
    closing,
    setClosing,
  ] = useState(false);

  const [
    view,
    setView,
  ] = useState<LauncherView>(
    "menu",
  );

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  const closeTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const busyRef = useRef(busy);
  const closingRef = useRef(closing);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    closingRef.current = closing;
  }, [closing]);


  const canOpen =
    capabilities.edit ||
    capabilities.assign ||
    capabilities.archive;


  useEffect(() => {
    return () => {
      if (
        closeTimerRef.current
      ) {
        clearTimeout(
          closeTimerRef.current,
        );
      }
    };
  }, []);


  const requestClose =
    useCallback(() => {
      if (
        busyRef.current ||
        closingRef.current
      ) {
        return;
      }

      setClosing(true);

      closeTimerRef.current =
        setTimeout(() => {
          setMounted(false);
          setClosing(false);
          setView("menu");
          setError(null);

          closeTimerRef.current =
            null;
        }, closeDurationMs);
    }, []);


  useEffect(() => {
    if (!mounted) return;

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        event.key !== "Escape"
      ) {
        return;
      }

      if (
        view !== "menu"
      ) {
        setError(null);
        setView("menu");
        return;
      }

      requestClose();
    }

    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown,
      );

      document.body.style.overflow =
        previousOverflow;
    };
  }, [mounted, view, requestClose]);


  function openLauncher() {
    if (!canOpen) return;

    if (
      closeTimerRef.current
    ) {
      clearTimeout(
        closeTimerRef.current,
      );

      closeTimerRef.current =
        null;
    }

    setError(null);
    setView("menu");
    setClosing(false);
    setMounted(true);
  }


  function openView(
    nextView: LauncherView,
  ) {
    setError(null);
    setView(nextView);
  }


  function backToMenu() {
    if (busy) return;

    setError(null);
    setView("menu");
  }


  function describeFailure(
    result: ProjectBulkResult,
  ) {
    return (
      result.failed[0]?.error ??
      "The request could not be completed."
    );
  }


  async function assign(
    profileId: string | null,
  ) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const result =
        await assignProjectAction(
          orderId,
          profileId,
        );

      if (
        result.succeeded.length ===
        0
      ) {
        setError(
          describeFailure(result),
        );

        return;
      }

      setMounted(false);
      setClosing(false);
      setView("menu");

      router.refresh();
    } catch {
      setError(
        "The assignment could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }


  async function changeStatus(
    nextStatus: OrderStatus,
  ) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const result =
        await changeProjectStatusAction(
          orderId,
          nextStatus,
        );

      if (
        result.succeeded.length ===
        0
      ) {
        setError(
          describeFailure(result),
        );

        return;
      }

      setMounted(false);
      setClosing(false);
      setView("menu");

      router.refresh();
    } catch {
      setError(
        "The project status could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }


  async function archive() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const result =
        await archiveProjectAction(
          orderId,
        );

      if (
        result.succeeded.length ===
        0
      ) {
        setError(
          describeFailure(result),
        );

        return;
      }

      setMounted(false);
      setClosing(false);
      setView("menu");

      router.push("/orders");
    } catch {
      setError(
        "The project could not be archived.",
      );
    } finally {
      setBusy(false);
    }
  }


  if (!canOpen) {
    return null;
  }


  const panelTitle =
    view === "assign"
      ? "Assign this project"
      : view === "status"
        ? "Change status"
        : view === "archive"
          ? "Archive project"
          : "Project actions";


  const overlay =
    mounted
      ? createPortal(
          <div
            className={`${styles.backdrop} ${
              closing
                ? styles.backdropClosing
                : styles.backdropOpen
            }`}
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                requestClose();
              }
            }}
          >
            <section
              className={`${styles.panel} ${
                closing
                  ? styles.panelClosing
                  : styles.panelOpen
              }`}
              role="dialog"
              aria-modal="true"
              aria-label={
                panelTitle
              }
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
                <div
                  className={
                    styles.panelHeading
                  }
                >
                  <span
                    className={
                      styles.eyebrow
                    }
                  >
                    PROJECT
                  </span>

                  <h2>
                    {panelTitle}
                  </h2>
                </div>

                <button
                  type="button"
                  className={
                    styles.closeButton
                  }
                  aria-label="Close project actions"
                  disabled={busy}
                  onClick={
                    requestClose
                  }
                >
                  <X
                    size={18}
                    aria-hidden="true"
                  />
                </button>
              </header>


              {error ? (
                <div
                  className={
                    styles.errorBanner
                  }
                  role="alert"
                >
                  <TriangleAlert
                    size={16}
                    aria-hidden="true"
                  />

                  <span>
                    {error}
                  </span>
                </div>
              ) : null}


              <div
                className={
                  styles.panelBody
                }
              >
                {view === "menu" ? (
                  <div
                    className={
                      styles.menu
                    }
                  >
                    {capabilities.edit ? (
                      <Link
                        className={
                          styles.menuRow
                        }
                        href={`/orders/${orderId}/edit`}
                        onClick={() => {
                          setMounted(
                            false,
                          );
                        }}
                      >
                        <span
                          className={
                            styles.menuIcon
                          }
                        >
                          <PencilLine
                            size={18}
                            aria-hidden="true"
                          />
                        </span>

                        <span
                          className={
                            styles.menuCopy
                          }
                        >
                          <strong>
                            Edit project
                          </strong>

                          <small>
                            Update project details,
                            priority, dates, and
                            notes.
                          </small>
                        </span>

                        <ChevronRight
                          className={styles.menuArrow}
                          size={16}
                          aria-hidden="true"
                        />
                      </Link>
                    ) : null}


                    {capabilities.assign ? (
                      <button
                        type="button"
                        className={
                          styles.menuRow
                        }
                        onClick={() =>
                          openView(
                            "assign",
                          )
                        }
                      >
                        <span
                          className={
                            styles.menuIcon
                          }
                        >
                          <UserRound
                            size={18}
                            aria-hidden="true"
                          />
                        </span>

                        <span
                          className={
                            styles.menuCopy
                          }
                        >
                          <strong>
                            Assign this project to
                          </strong>

                          <small>
                            Choose the teammate
                            responsible for this
                            project.
                          </small>
                        </span>

                        <ChevronRight
                          className={styles.menuArrow}
                          size={16}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}


                    {capabilities.edit ? (
                      <button
                        type="button"
                        className={
                          styles.menuRow
                        }
                        onClick={() =>
                          openView(
                            "status",
                          )
                        }
                      >
                        <span
                          className={
                            styles.menuIcon
                          }
                        >
                          <CircleCheckBig
                            size={18}
                            aria-hidden="true"
                          />
                        </span>

                        <span
                          className={
                            styles.menuCopy
                          }
                        >
                          <strong>
                            Change status
                          </strong>

                          <small>
                            Move this project to
                            another workflow stage.
                          </small>
                        </span>

                        <ChevronRight
                          className={styles.menuArrow}
                          size={16}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}


                    {capabilities.archive ? (
                      <button
                        type="button"
                        className={`${styles.menuRow} ${styles.dangerRow}`}
                        onClick={() =>
                          openView(
                            "archive",
                          )
                        }
                      >
                        <span
                          className={`${styles.menuIcon} ${styles.dangerIcon}`}
                        >
                          <Archive
                            size={18}
                            aria-hidden="true"
                          />
                        </span>

                        <span
                          className={
                            styles.menuCopy
                          }
                        >
                          <strong>
                            Archive project
                          </strong>

                          <small>
                            Remove this project from
                            active project views.
                          </small>
                        </span>

                        <ChevronRight
                          className={styles.menuArrow}
                          size={16}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </div>
                ) : null}


                {view === "assign" ? (
                  <div
                    className={
                      styles.subView
                    }
                  >
                    <button
                      type="button"
                      className={
                        styles.backButton
                      }
                      disabled={busy}
                      onClick={
                        backToMenu
                      }
                    >
                      <ArrowLeft
                        size={15}
                        aria-hidden="true"
                      />

                      Project actions
                    </button>

                    <p
                      className={
                        styles.subCopy
                      }
                    >
                      Select who should own
                      this project.
                    </p>

                    <div
                      className={
                        styles.optionList
                      }
                    >
                      <button
                        type="button"
                        className={`${styles.optionRow} ${
                          assigneeId ===
                          null
                            ? styles.optionSelected
                            : ""
                        }`}
                        disabled={busy}
                        onClick={() =>
                          assign(null)
                        }
                      >
                        <span
                          className={
                            styles.optionAvatar
                          }
                        >
                          <UserRound
                            size={16}
                            aria-hidden="true"
                          />
                        </span>

                        <span
                          className={
                            styles.optionCopy
                          }
                        >
                          <strong>
                            Unassigned
                          </strong>

                          <small>
                            No teammate assigned
                          </small>
                        </span>

                        {assigneeId ===
                        null ? (
                          <Check
                            size={16}
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>

                      {people.map(
                        (person) => {
                          const selected =
                            person.id ===
                            assigneeId;

                          return (
                            <button
                              key={
                                person.id
                              }
                              type="button"
                              className={`${styles.optionRow} ${
                                selected
                                  ? styles.optionSelected
                                  : ""
                              }`}
                              disabled={
                                busy
                              }
                              onClick={() =>
                                assign(
                                  person.id,
                                )
                              }
                            >
                              <span
                                className={
                                  styles.optionAvatar
                                }
                              >
                                <UserRound
                                  size={16}
                                  aria-hidden="true"
                                />
                              </span>

                              <span
                                className={
                                  styles.optionCopy
                                }
                              >
                                <strong>
                                  {
                                    person.name
                                  }
                                </strong>

                                <small>
                                  Wolf Forge
                                  teammate
                                </small>
                              </span>

                              {selected ? (
                                <Check
                                  size={16}
                                  aria-hidden="true"
                                />
                              ) : null}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                ) : null}


                {view === "status" ? (
                  <div
                    className={
                      styles.subView
                    }
                  >
                    <button
                      type="button"
                      className={
                        styles.backButton
                      }
                      disabled={busy}
                      onClick={
                        backToMenu
                      }
                    >
                      <ArrowLeft
                        size={15}
                        aria-hidden="true"
                      />

                      Project actions
                    </button>

                    <p
                      className={
                        styles.subCopy
                      }
                    >
                      Choose the new workflow
                      status.
                    </p>

                    <div
                      className={
                        styles.optionList
                      }
                    >
                      {orderStatuses.map(
                        (
                          nextStatus,
                        ) => {
                          const selected =
                            nextStatus ===
                            status;

                          return (
                            <button
                              key={
                                nextStatus
                              }
                              type="button"
                              data-status={nextStatus}
                              className={`${styles.optionRow} ${
                                selected
                                  ? styles.optionSelected
                                  : ""
                              }`}
                              disabled={
                                busy
                              }
                              onClick={() =>
                                changeStatus(
                                  nextStatus,
                                )
                              }
                            >
                              <span
                                className={
                                  styles.statusDot
                                }
                                aria-hidden="true"
                              />

                              <span
                                className={
                                  styles.optionCopy
                                }
                              >
                                <strong>
                                  {
                                    projectStatusLabels[
                                      nextStatus
                                    ]
                                  }
                                </strong>

                                <small className={styles.statusHint}>{statusHint(nextStatus)}</small>
                              </span>

                              {selected ? (
                                <Check
                                  size={16}
                                  aria-hidden="true"
                                />
                              ) : null}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                ) : null}


                {view === "archive" ? (
                  <div
                    className={
                      styles.subView
                    }
                  >
                    <button
                      type="button"
                      className={
                        styles.backButton
                      }
                      disabled={busy}
                      onClick={
                        backToMenu
                      }
                    >
                      <ArrowLeft
                        size={15}
                        aria-hidden="true"
                      />

                      Project actions
                    </button>

                    <div
                      className={
                        styles.archiveNotice
                      }
                    >
                      <span
                        className={
                          styles.archiveIcon
                        }
                      >
                        <Archive
                          size={20}
                          aria-hidden="true"
                        />
                      </span>

                      <div>
                        <strong>
                          Archive this project?
                        </strong>

                        <p>
                          The project will leave
                          active project views.
                          This does not hard-delete
                          the project.
                        </p>
                      </div>
                    </div>

                    <div
                      className={
                        styles.archiveActions
                      }
                    >
                      <button
                        type="button"
                        className={
                          styles.cancelButton
                        }
                        disabled={busy}
                        onClick={
                          backToMenu
                        }
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        className={
                          styles.archiveButton
                        }
                        disabled={busy}
                        onClick={
                          archive
                        }
                      >
                        {busy
                          ? "Archiving..."
                          : "Archive project"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>


              {busy ? (
                <div
                  className={
                    styles.busyBar
                  }
                  aria-hidden="true"
                >
                  <span />
                </div>
              ) : null}
            </section>
          </div>,
          document.body,
        )
      : null;


  return (
    <div
      className={
        styles.launcherRow
      }
    >
      <button
        type="button"
        className={
          styles.launcher
        }
        aria-label="Open project actions"
        aria-expanded={
          mounted &&
          !closing
        }
        onClick={
          openLauncher
        }
      >
        <Plus
          size={20}
          aria-hidden="true"
        />
      </button>

      {overlay}
    </div>
  );
}