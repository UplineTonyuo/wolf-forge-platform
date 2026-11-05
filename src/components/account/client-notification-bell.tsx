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
  markOpenedClientNotificationsReadAction,
  markClientNotificationReadAction,
  type WalletNotificationItem,
  type NotificationUnreadCounts,
} from "../../app/actions/notifications";
import { shouldRingForUnread } from "../../domain/notifications/ring";
import { notificationPollDelay, NOTIFICATION_POLL_TICK_MS } from "../../domain/notifications/polling";
import { useTicketCacheRevocation } from "../tickets/use-ticket-cache-revocation";
import { notificationVisibleWithModules, visibleNotificationUnreadCount } from "../../domain/notifications/visibility";
import {
  playNotificationChime,
  unlockNotificationAudio,
} from "../../lib/notifications/browser-notification-feedback";
import { useHeaderPanels } from "./command/header-panels";
import styles from "./client-notification-bell.module.css";
import { randomUuid } from "../../lib/random-uuid";

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
  ticketsAvailable = true,
  projectsAvailable = true,
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
  ticketsAvailable?: boolean;
  projectsAvailable?: boolean;
} = {}) {
  const projectsAvailableRef = useRef(projectsAvailable);
  useEffect(() => { projectsAvailableRef.current = projectsAvailable; }, [projectsAvailable]);
  const ticketsAvailableRef = useRef(ticketsAvailable);
  useEffect(() => { ticketsAvailableRef.current = ticketsAvailable; }, [ticketsAvailable]);
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
  const loadInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const pollRef = useRef({ open: false, failures: 0, nextAt: 0 });

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

  useEffect(() => {
    const poll = pollRef.current;
    poll.open = open;
    poll.nextAt = Date.now() + notificationPollDelay(poll.open, poll.failures);
  }, [open]);

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
    cachedNotifications,
    setNotifications,
  ] =
    useState<
      WalletNotificationItem[]
    >([]);
  const cacheGeneration = useRef(0);
  const [totalUnread, setTotalUnread] = useState<number | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<NotificationUnreadCounts | null>(null);
  useTicketCacheRevocation(() => {
    setNotifications((items) => items.filter((item) => notificationVisibleWithModules(item, false, true)));
    setTotalUnread(null);
    setUnreadCounts(null);
    setRinging(false);
  }, cacheGeneration);
  const notifications = cachedNotifications.filter((item) => notificationVisibleWithModules(item, ticketsAvailable, projectsAvailable));
  const openingRequest = useRef<{requestId:string;requestedAt:string} | null>(null);
  const readInFlight = useRef(false);
  const queuedOpening = useRef(false);
  const readVersion = useRef(0);
  const serverClockOffset = useRef(0);
  const [readError, setReadError] = useState(false);
  const [openingExpired, setOpeningExpired] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const markOpening = useCallback(async function markOpening(deliberate = true) {
    if (readInFlight.current) { if (deliberate) queuedOpening.current = true; return; }
    if (!openingRequest.current) openingRequest.current = {requestId:randomUuid(),requestedAt:new Date(Date.now()+serverClockOffset.current).toISOString()};
    else if (deliberate) queuedOpening.current = true;
    readInFlight.current = true;
    const generation = cacheGeneration.current;
    readVersion.current++;
    setMarkingRead(true);
    let continueOpening = false;
    try {
      const result = await markOpenedClientNotificationsReadAction(openingRequest.current);
      if (!result.ok) {
        if (result.code === "OPENING_EXPIRED") {
          openingRequest.current=null;
          queuedOpening.current=false;
          setOpeningExpired(true);
          if (result.serverTime && Number.isFinite(Date.parse(result.serverTime))) serverClockOffset.current=Date.parse(result.serverTime)-Date.now();
        }
        setReadError(true); return;
      }
      const items=result.notifications.filter(item=>notificationVisibleWithModules(item,generation === cacheGeneration.current && ticketsAvailableRef.current,projectsAvailableRef.current));
      setNotifications(items);
      setTotalUnread(generation === cacheGeneration.current ? result.unreadCount ?? null : null);
      setUnreadCounts(generation === cacheGeneration.current ? result.unreadCounts ?? null : null);
      openingRequest.current=null;
      setReadError(false);
      setOpeningExpired(false);
      continueOpening=queuedOpening.current; queuedOpening.current=false;
    } catch { setReadError(true); }
    finally { readVersion.current++; readInFlight.current = false; setMarkingRead(false); if (continueOpening) void markOpening(); }
  }, []);

  const noteIncoming =
    useCallback(
      (
        items:
          WalletNotificationItem[],
      ) => {
        items = items.filter((item) => notificationVisibleWithModules(item, ticketsAvailableRef.current, projectsAvailableRef.current));
        const generation = cacheGeneration.current;
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
          (item, index) => {
            const startTimer =
              window.setTimeout(
                () => {
                  if (
                    soundEnabledRef.current && notificationVisibleWithModules(item, ticketsAvailableRef.current, projectsAvailableRef.current)
                    && (generation === cacheGeneration.current || notificationVisibleWithModules(item, false, true))
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
      async function load(
        silent = false,
        isActive?: () => boolean,
        queueIfBusy = false,
      ) {
        if (document.hidden || !navigator.onLine) return;
        if (
          isActive &&
          !isActive()
        ) {
          return;
        }

        if (loadInFlightRef.current) {
          if (!silent || queueIfBusy) refreshPendingRef.current = true;
          return;
        }
        loadInFlightRef.current = true;

        if (!silent) {
          setLoading(true);
        }

        const generation = cacheGeneration.current;
        const version = readVersion.current;
        try {
          const result =
            await getClientNotificationsAction();
          pollRef.current.failures = result.ok ? 0 : Math.min(pollRef.current.failures + 1, 7);

          if (
            isActive &&
            !isActive()
          ) {
            return;
          }

          if (result.ok) {
            if (readInFlight.current || version !== readVersion.current) return;
            const items = generation === cacheGeneration.current ? result.notifications
              : result.notifications.filter((item) => notificationVisibleWithModules(item, false, true));
            noteIncoming(
              items,
            );

            setNotifications(items);
            setTotalUnread(generation === cacheGeneration.current ? result.unreadCount ?? null : null);
            setUnreadCounts(generation === cacheGeneration.current ? result.unreadCounts ?? null : null);

            setError(null);
          } else if (!silent) {
            setError(
              result.error,
            );
          }

        } catch {
          pollRef.current.failures = Math.min(pollRef.current.failures + 1, 7);
          if (!silent && (!isActive || isActive())) {
            setError("Unable to load notifications.");
          }
        } finally {
          if (!silent && (!isActive || isActive())) {
            setLoading(false);
          }
          loadInFlightRef.current = false;
          const poll = pollRef.current;
          poll.nextAt = Date.now() + notificationPollDelay(poll.open, poll.failures);
          const refreshPending = refreshPendingRef.current;
          refreshPendingRef.current = false;
          if (refreshPending && !document.hidden) {
            void load(true);
          }
        }
      },
      [noteIncoming],
    );

  useEffect(
    () => {
      let active = true;

      void Promise.resolve().then(
        () =>
          load(
            false,
            () => active,
          ),
      );

      return () => {
        active = false;
      };
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
      // The local tick checks the deadline; a closed bell fetches only once a minute.
      const refresh = () => {
        if (!document.hidden && navigator.onLine && Date.now() >= pollRef.current.nextAt) {
          void load(true);
        }
      };
      const refreshOnReturn = () => {
        if (!document.hidden) void load(true, undefined, true);
      };

      const interval =
        window.setInterval(
          refresh,
          NOTIFICATION_POLL_TICK_MS,
        );

      window.addEventListener(
        "focus",
        refreshOnReturn,
      );
      window.addEventListener("online", refreshOnReturn);

      document.addEventListener(
        "visibilitychange",
        refreshOnReturn,
      );

      return () => {
        window.clearInterval(
          interval,
        );

        window.removeEventListener(
          "focus",
          refreshOnReturn,
        );
        window.removeEventListener("online", refreshOnReturn);

        document.removeEventListener(
          "visibilitychange",
          refreshOnReturn,
        );
        refreshPendingRef.current = false;
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

  const unread = visibleNotificationUnreadCount(totalUnread,unreadCounts,ticketsAvailable,projectsAvailable) ??
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
    ).then(() => load(true, undefined, true));

    setOpen(false);
  }

  function markAllAsRead() {
    void markOpening();
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
          const explicitlyOpening = managed ? !(open && panels.pinned) : !open;
          if (explicitlyOpening) {
            void markOpening();
          }
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
            {markingRead ? <small role="status">Marking read…</small> : readError ? <button type="button" onClick={() => void markOpening(false)}>{openingExpired ? "Mark current notifications read" : "Retry marking read"}</button> : null}
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
