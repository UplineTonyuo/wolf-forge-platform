"use client";

import {
  Bell,
  FileText,
  Folder,
  MessageSquare,
  Receipt,
  ShoppingCart,
  Ticket,
  UserPlus,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getClientNotificationsAction,
  markAllClientNotificationsReadAction,
  markClientNotificationReadAction,
  type WalletNotificationItem,
} from "../../app/actions/notifications";
import { shouldRingForUnread } from "../../domain/notifications/ring";
import {
  playNotificationChime,
  unlockNotificationAudio,
} from "../../lib/notifications/browser-notification-feedback";
import { useHeaderPanels } from "./command/header-panels";
import styles from "./client-notification-bell.module.css";

function formatActivityTime(
  value: string,
) {
  const date =
    new Date(value);

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
export function ClientNotificationBell({
  soundEnabled = true,
  inCommandBar = false,
}: {
  /**
   * The account's own notification_sound_enabled preference, read server-side
   * from app_get_my_profile. The toggle on the Profile page therefore changes
   * something real rather than storing a value nothing consults.
   */
  soundEnabled?: boolean;
  /**
   * Drops the standalone fixed positioning so the bell sits inline in the
   * command bar. Notification behaviour, counts and the panel are untouched.
   */
  inCommandBar?: boolean;
} = {}) {
  const rootRef =
    useRef<HTMLDivElement>(
      null,
    );

  /*
   * Read through a ref inside the arrival timers: the preference can change
   * between a notification arriving and its staggered chime firing, and the
   * timer must see the current value rather than the one captured at schedule
   * time. Synced in an effect rather than written during render, which React
   * does not allow.
   */
  const soundEnabledRef =
    useRef(soundEnabled);

  useEffect(
    () => {
      soundEnabledRef.current =
        soundEnabled;
    },
    [soundEnabled],
  );

  const seenIdsRef =
    useRef<Set<string>>(
      new Set(),
    );

  const initializedRef =
    useRef(false);

  /*
   * The unread count the bell last evaluated. Held in a ref so the milestone
   * comparison runs exactly once per feed update rather than on every render.
   */
  const lastUnreadRef =
    useRef(0);

  const feedbackTimersRef =
    useRef<number[]>([]);

  /*
   * Inside the command bar the header panel manager owns which panel is open,
   * which is what makes overlapping impossible. Standalone (and in tests) the
   * bell keeps its own state, so nothing about its behaviour depends on being
   * inside a provider.
   */
  const panels =
    useHeaderPanels();

  const managed =
    inCommandBar &&
    panels !== null;

  const [
    localOpen,
    setLocalOpen,
  ] =
    useState(false);

  const open = managed
    ? panels.isOpen(
        "notifications",
      )
    : localOpen;

  const setOpen = (
    next: boolean,
  ) => {
    if (!managed) {
      setLocalOpen(next);
      return;
    }

    if (next) {
      panels.pin(
        "notifications",
      );
    } else {
      panels.close();
    }
  };

  const [
    ringing,
    setRinging,
  ] =
    useState(false);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    notifications,
    setNotifications,
  ] =
    useState<
      WalletNotificationItem[]
    >([]);

  const noteIncoming =
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
         * The first feed of a session establishes the baseline. Without this the
         * bell would ring on every mount for a client who already had unread
         * notifications waiting, which is not new activity.
         */
        if (
          !initializedRef.current
        ) {
          seenIdsRef.current =
            nextIds;

          lastUnreadRef.current =
            unread;

          initializedRef.current =
            true;

          return;
        }

        const incoming =
          items.filter(
            (item) =>
              !item.readAt &&
              !seenIdsRef.current.has(
                item.id,
              ),
          );

        seenIdsRef.current =
          nextIds;

        /*
         * Motion is gated on the unread milestone; the chime below is not. The
         * sound already had its own cadence before this change and altering it
         * was out of scope, so the two are deliberately decoupled here.
         */
        const ring =
          shouldRingForUnread(
            lastUnreadRef.current,
            unread,
          );

        lastUnreadRef.current =
          unread;

        if (ring) {
          setRinging(true);

          const stopTimer =
            window.setTimeout(
              () => {
                setRinging(false);
              },
              560,
            );

          feedbackTimersRef.current.push(
            stopTimer,
          );
        }

        incoming.forEach(
          (_, index) => {
            const startTimer =
              window.setTimeout(
                () => {
                  if (
                    soundEnabledRef.current
                  ) {
                    playNotificationChime();
                  }
                },
                index * 680,
              );

            feedbackTimersRef.current.push(
              startTimer,
            );
          },
        );
      },
      [],
    );

  const load =
    useCallback(
      async (
        silent = false,
      ) => {
        if (!silent) {
          setLoading(true);
        }

        const result =
          await getClientNotificationsAction();

        if (result.ok) {
          noteIncoming(
            result.notifications,
          );

          setNotifications(
            result.notifications,
          );

          setError(null);
        } else if (!silent) {
          setError(
            result.error,
          );
        }

        if (!silent) {
          setLoading(false);
        }
      },
      [noteIncoming],
    );

  useEffect(
    () => {
      void load();
    },
    [load],
  );

  useEffect(
    () => {
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
    },
    [],
  );

  useEffect(
    () => {
      const refresh = () => {
        if (!document.hidden) {
          void load(true);
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
    },
    [load],
  );

  useEffect(
    () => {
      if (!open || managed) {
        return;
      }

      /*
       * This branch only runs unmanaged, so it closes the local state directly
       * rather than through the shared setter — the stable setter keeps the
       * effect's dependency list honest.
       */
      function handlePointerDown(
        event: PointerEvent,
      ) {
        if (
          !rootRef.current?.contains(
            event.target as Node,
          )
        ) {
          setLocalOpen(false);
        }
      }

      function handleKeyDown(
        event: KeyboardEvent,
      ) {
        if (
          event.key ===
          "Escape"
        ) {
          setLocalOpen(false);
        }
      }

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
    },
    [open, managed],
  );

  useEffect(
    () => {
      return () => {
        feedbackTimersRef.current.forEach(
          (timer) => {
            window.clearTimeout(
              timer,
            );
          },
        );

        feedbackTimersRef.current =
          [];
      };
    },
    [],
  );

  const unread =
    notifications.filter(
      (notification) =>
        !notification.readAt,
    ).length;

  const badgeLabel =
    unread > 99
      ? "99+"
      : String(unread);

  function read(
    notification:
      WalletNotificationItem,
  ) {
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

    void markClientNotificationReadAction(
      notification.id,
    );

    setOpen(false);
  }

  function markAllAsRead() {
    if (unread === 0) {
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

    void markAllClientNotificationsReadAction();
  }
  return (
    <div
      ref={rootRef}
      data-header-panel-root=""
      onPointerEnter={() =>
        panels?.cancelClose()
      }
      onPointerLeave={() =>
        panels?.hoverLeave()
      }
      className={[
        styles.root,
        inCommandBar
          ? styles.inCommandBar
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className={[
          styles.trigger,
          open
            ? styles.triggerOpen
            : "",
          ringing
            ? styles.ringing
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Notifications"
        title="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        onPointerEnter={(
          event,
        ) => {
          if (
            !managed ||
            event.pointerType !==
              "mouse"
          ) {
            return;
          }

          panels.hoverOpen(
            "notifications",
          );

          void load();
        }}
        onFocus={() =>
          panels?.cancelClose()
        }
        onClick={() => {
          if (managed) {
            panels.toggle(
              "notifications",
            );
            void unlockNotificationAudio();
            void load();
            return;
          }

          const next =
            !open;

          setOpen(next);

          if (next) {
            void unlockNotificationAudio();
            void load();
          }
        }}
      >
        <Bell
          aria-hidden="true"
        />

        {unread > 0 ? (
          <span
            className={
              "wf-count-badge"
            }
            aria-label={`${unread} unread notifications`}
          >
            {badgeLabel}
          </span>
        ) : null}
      </button>

      <section
        className={
          open
            ? `${styles.panel} ${styles.panelOpen}`
            : styles.panel
        }
        aria-hidden={!open}
        aria-label="Notifications"
      >
        <header
          className={
            styles.header
          }
        >
          <div>
            <strong>
              Notifications
            </strong>

            <span>
              Recent activity
            </span>
          </div>

          <div className={styles.headerActions}>
            {loading ? (
              <small>
                Refreshing...
              </small>
            ) : null}

            {unread > 0 ? (
              <button
                type="button"
                className={styles.markAll}
                onClick={markAllAsRead}
              >
                Mark all as read
              </button>
            ) : (
              <span className={styles.allRead}>
                All read
              </span>
            )}
          </div>
        </header>

        <div
          className={
            styles.list
          }
        >
          {error ? (
            <div
              className={
                styles.empty
              }
            >
              {error}
            </div>
          ) : notifications.length ===
              0 &&
            !loading ? (
            <div
              className={
                styles.empty
              }
            >
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
                  className={
                    !notification.readAt
                      ? `${styles.item} ${styles.unread}`
                      : styles.item
                  }
                  onClick={() =>
                    read(
                      notification,
                    )
                  }
                >
                  <span
                    className={
                      styles.icon
                    }
                  >
                    <NotificationCategoryIcon
                      category={
                        notification.category
                      }
                    />
                  </span>

                  <span
                    className={
                      styles.copy
                    }
                  >
                    <strong>
                      {
                        notification.title
                      }
                    </strong>

                    <span>
                      {
                        notification.body
                      }
                    </span>

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
    </div>
  );
}