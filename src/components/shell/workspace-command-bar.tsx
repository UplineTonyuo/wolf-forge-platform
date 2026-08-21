"use client";

import {
  Bell,
  FileText,
  Folder,
Images,
  MessageSquare,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Ticket,
  UserPlus,
  WalletCards,
} from "lucide-react";
import { GlobalSearch } from "./global-search";
import { DashboardDateTrigger } from "../dashboard/dashboard-date-trigger";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createPortal,
} from "react-dom";
import {
  getWalletNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
  type WalletNotificationItem,
} from "../../app/actions/notifications";
import { shouldRingForUnread } from "../../domain/notifications/ring";
import {
  playNotificationChime,
  unlockNotificationAudio,
} from "../../lib/notifications/browser-notification-feedback";
import type {
  InternalUser,
} from "../../lib/supabase/next-server";
import {
  AccountMenu,
} from "./account-menu";
import {
  WorkspaceQuickAction,
} from "./workspace-quick-action";

function formatActivityTime(
  value: string,
) {
  const date = new Date(value);

  return new Intl.DateTimeFormat(
    undefined,
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

function NotificationCategoryIcon({
  category,
}: {
  category:
    WalletNotificationItem["category"];
}) {
  const Icon =
    category === "project"
      ? Folder
      : category === "client"
        ? UserPlus
        : category === "form"
          ? FileText
          : category === "coupon"
            ? Ticket
            : category === "ticket"
              ? MessageSquare
              : category === "payment"
                ? Receipt
                : category === "wallet"
                  ? WalletCards
                  : category === "store"
                    ? ShoppingCart
                    : Bell;

  return (
    <Icon aria-hidden="true" />
  );
}
type NotificationPosition = {
  top: number;
  right: number;
};

export function WorkspaceCommandBar({
  user,
}: {
  user: InternalUser;
}) {
  const triggerRef =
    useRef<HTMLButtonElement>(null);

  const panelRef =
    useRef<HTMLElement>(null);

  const [
    mounted,
    setMounted,
  ] = useState(false);

  const [
    notifications,
    setNotifications,
  ] = useState<
    WalletNotificationItem[]
  >([]);

  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);

  const [
    notificationsLoading,
    setNotificationsLoading,
  ] = useState(false);

  const [
    notificationsError,
    setNotificationsError,
  ] = useState<string | null>(
    null,
  );

  const [
    notificationPosition,
    setNotificationPosition,
  ] =
    useState<NotificationPosition>({
      top: 76,
      right: 20,
    });

  const [
    notificationRinging,
    setNotificationRinging,
  ] = useState(false);

  const notificationSeenIdsRef =
    useRef<Set<string>>(
      new Set(),
    );

  const notificationFeedInitializedRef =
    useRef(false);

  /*
   * The unread count the bell last evaluated. A ref so the milestone comparison
   * runs once per feed update rather than on every render.
   */
  const lastUnreadNotificationsRef =
    useRef(0);

  const notificationFeedbackTimersRef =
    useRef<number[]>([]);

  const noteIncomingNotifications =
    useCallback(
      (
        items:
          WalletNotificationItem[],
      ) => {
        const nextIds =
          new Set(
            items.map(
              (item) =>
                item.id,
            ),
          );

        const unread =
          items.filter(
            (item) =>
              !item.readAt,
          ).length;

        /*
         * The first feed of a session sets the baseline, so arriving at a
         * workspace that already had unread notifications is not treated as new
         * activity and the bell stays still.
         */
        if (
          !notificationFeedInitializedRef.current
        ) {
          notificationSeenIdsRef.current =
            nextIds;

          lastUnreadNotificationsRef.current =
            unread;

          notificationFeedInitializedRef.current =
            true;

          return;
        }

        const incoming =
          items.filter(
            (item) =>
              !item.readAt &&
              !notificationSeenIdsRef.current.has(
                item.id,
              ),
          );

        notificationSeenIdsRef.current =
          nextIds;

        /*
         * Motion is gated on the unread milestone; the chime below is not. The
         * sound already had its own cadence before this change and altering it
         * was out of scope, so the two are deliberately decoupled here.
         */
        const ring =
          shouldRingForUnread(
            lastUnreadNotificationsRef.current,
            unread,
          );

        lastUnreadNotificationsRef.current =
          unread;

        if (ring) {
          setNotificationRinging(
            true,
          );

          const stopTimer =
            window.setTimeout(
              () => {
                setNotificationRinging(
                  false,
                );
              },
              560,
            );

          notificationFeedbackTimersRef.current.push(
            stopTimer,
          );
        }

        incoming.forEach(
          (_, index) => {
            const startTimer =
              window.setTimeout(
                () => {
                  playNotificationChime();
                },
                index * 680,
              );

            notificationFeedbackTimersRef.current.push(
              startTimer,
            );
          },
        );
      },
      [],
    );

  const loadNotifications =
    useCallback(
      async (
        silent = false,
      ) => {
        if (!silent) {
          setNotificationsLoading(
            true,
          );
        }

        const result =
          await getWalletNotificationsAction();

        if (result.ok) {
          noteIncomingNotifications(
            result.notifications,
          );

          setNotifications(
            result.notifications,
          );

          setNotificationsError(
            null,
          );
        } else if (!silent) {
          setNotificationsError(
            result.error,
          );
        }

        if (!silent) {
          setNotificationsLoading(
            false,
          );
        }
      },
      [
        noteIncomingNotifications,
      ],
    );

  const updatePanelPosition =
    useCallback(() => {
      const trigger =
        triggerRef.current;

      if (!trigger) {
        return;
      }

      const rect =
        trigger.getBoundingClientRect();

      const right =
        Math.max(
          12,
          window.innerWidth -
            rect.right,
        );

      setNotificationPosition({
        top: rect.bottom + 10,
        right,
      });
    }, []);

  useEffect(() => {
    setMounted(true);

    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const unlock = () => {
      void unlockNotificationAudio();
    };

    window.addEventListener(
      "pointerdown",
      unlock,
      {
        once: true,
        passive: true,
      },
    );

    window.addEventListener(
      "keydown",
      unlock,
      {
        once: true,
      },
    );

    return () => {
      window.removeEventListener(
        "pointerdown",
        unlock,
      );

      window.removeEventListener(
        "keydown",
        unlock,
      );
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        void loadNotifications(
          true,
        );
      }
    };

    const interval =
      window.setInterval(
        refresh,
        4000,
      );

    window.addEventListener(
      "focus",
      refresh,
    );

    document.addEventListener(
      "visibilitychange",
      refresh,
    );

    return () => {
      window.clearInterval(
        interval,
      );

      window.removeEventListener(
        "focus",
        refresh,
      );

      document.removeEventListener(
        "visibilitychange",
        refresh,
      );
    };
  }, [loadNotifications]);

  useEffect(() => {
    return () => {
      notificationFeedbackTimersRef.current.forEach(
        (timer) => {
          window.clearTimeout(
            timer,
          );
        },
      );

      notificationFeedbackTimersRef.current =
        [];
    };
  }, []);

  useEffect(() => {
    if (!notificationsOpen) {
      return;
    }

    updatePanelPosition();

    const handleResize = () => {
      updatePanelPosition();
    };

    const handleScroll = () => {
      updatePanelPosition();
    };

    window.addEventListener(
      "resize",
      handleResize,
    );

    window.addEventListener(
      "scroll",
      handleScroll,
      true,
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize,
      );

      window.removeEventListener(
        "scroll",
        handleScroll,
        true,
      );
    };
  }, [
    notificationsOpen,
    updatePanelPosition,
  ]);

  useEffect(() => {
    const closeForQuickAction = () => {
      setNotificationsOpen(false);
    };

    window.addEventListener(
      "wf:quick-action-open",
      closeForQuickAction,
    );

    return () => {
      window.removeEventListener(
        "wf:quick-action-open",
        closeForQuickAction,
      );
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (
      event: PointerEvent,
    ) => {
      if (!notificationsOpen) {
        return;
      }

      const target =
        event.target as Node;

      const trigger =
        triggerRef.current;

      const panel =
        panelRef.current;

      if (
        trigger?.contains(target) ||
        panel?.contains(target)
      ) {
        return;
      }

      setNotificationsOpen(false);
    };

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        setNotificationsOpen(
          false,
        );
      }
    };

    document.addEventListener(
      "pointerdown",
      handlePointerDown,
    );

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown,
      );

      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [notificationsOpen]);

  const toggleNotifications =
    async () => {
      if (notificationsOpen) {
        setNotificationsOpen(false);
        return;
      }

      updatePanelPosition();

      setNotificationsOpen(true);

      await loadNotifications();
    };

  const unreadNotificationCount =
    notifications.reduce(
      (
        total,
        notification,
      ) =>
        total +
        (notification.readAt
          ? 0
          : 1),
      0,
    );

  const notificationBadgeLabel =
    unreadNotificationCount > 99
      ? "99+"
      : String(
          unreadNotificationCount,
        );
  const markAllAsRead = () => {
    if (
      unreadNotificationCount === 0
    ) {
      return;
    }

    const readAt =
      new Date().toISOString();

    setNotifications(
      (current) =>
        current.map(
          (notification) =>
            notification.readAt
              ? notification
              : {
                  ...notification,
                  readAt,
                },
        ),
    );

    void markAllNotificationsReadAction();
  };
  const notificationPanel = (
    <section
      ref={panelRef}
      className={
        notificationsOpen
          ? "workspace-notification-portal is-open"
          : "workspace-notification-portal"
      }
      style={{
        top:
          notificationPosition.top,
        right:
          notificationPosition.right,
      }}
      aria-hidden={
        !notificationsOpen
      }
      aria-label="Notifications"
    >
      <header className="workspace-notification-header">
        <div>
          <strong>
            Notifications
          </strong>

          <span>
            Recent activity
          </span>
        </div>

        <div className="workspace-notification-header-actions">
          {notificationsLoading ? (
            <span className="workspace-notification-refreshing">
              Refreshing...
            </span>
          ) : null}

          {unreadNotificationCount > 0 ? (
            <button
              type="button"
              className="workspace-notification-mark-all"
              onClick={markAllAsRead}
            >
              Mark all as read
            </button>
          ) : (
            <span className="workspace-notification-all-read">
              All read
            </span>
          )}
        </div>
      </header>

      <div className="workspace-notification-list">
        {notificationsError ? (
          <div className="workspace-notification-empty">
            {notificationsError}
          </div>
        ) : notifications.length ===
            0 &&
          !notificationsLoading ? (
          <div className="workspace-notification-empty">
            No activity yet.
          </div>
        ) : (
          notifications.map(
            (notification) => (
              <Link
                key={
                  notification.id
                }
                href={
                  notification.href
                }
                className="workspace-notification-item"
                onClick={() => {
                  setNotifications(
                    (current) =>
                      current.map(
                        (item) =>
                          item.id ===
                          notification.id
                            ? {
                                ...item,
                                readAt:
                                  item.readAt ??
                                  new Date().toISOString(),
                              }
                            : item,
                      ),
                  );

                  void markNotificationReadAction(
                    notification.id,
                  );

                  setNotificationsOpen(
                    false,
                  );
                }}
              >
                <span
                  className={
                    notification.kind ===
                    "credit"
                      ? "workspace-notification-kind is-credit"
                      : "workspace-notification-kind is-debit"
                  }
                >
                  <NotificationCategoryIcon
                    category={
                      notification.category
                    }
                  />
                </span>

                <span className="workspace-notification-copy">
                  <strong>
                    {
                      notification.title
                    }
                  </strong>

                  <span className="workspace-notification-body">
                    {
                      notification.body
                    }
                  </span>

                  {notification.reason ? (
                    <span className="workspace-notification-reason">
                      Reason:{" "}
                      {
                        notification.reason
                      }
                    </span>
                  ) : null}

                  <time
                    dateTime={
                      notification.createdAt
                    }
                  >
                    {formatActivityTime(
                      notification.createdAt,
                    )}
                  </time>
                </span>
              </Link>
            ),
          )
        )}
      </div>
    </section>
  );

  return (
    <>
      <div
        className="workspace-command-bar"
        aria-label="Workspace controls"
      >
        <GlobalSearch />
        <div className="workspace-command-shortcuts">
        <DashboardDateTrigger />
          <button
            className="workspace-command-button"
            type="button"
            aria-label="Gallery"
            title="Gallery"
          >
            <Images
              aria-hidden="true"
            />
          </button>

          <button
            ref={triggerRef}
            className={[
              "workspace-command-button",
              "workspace-notification-trigger",
              notificationsOpen
                ? "is-open"
                : "",
              notificationRinging
                ? "is-ringing"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            aria-label="Notifications"
            title="Notifications"
            aria-expanded={
              notificationsOpen
            }
            aria-haspopup="dialog"
            onClick={
              toggleNotifications
            }
          >
            <Bell
              aria-hidden="true"
            />

            {notifications.some((notification) => !notification.readAt) ? (
              <span
                className="workspace-notification-badge wf-count-badge"
                aria-label={`${unreadNotificationCount} unread notifications`}
              >
                {notificationBadgeLabel}
              </span>
            ) : null}
          </button>

          <WorkspaceQuickAction
            user={user}
          />
        </div>

        <div className="workspace-command-profile">
          <AccountMenu
            user={user}
          />
        </div>
      </div>

      {mounted
        ? createPortal(
            notificationPanel,
            document.body,
          )
        : null}
    </>
  );
}