"use client";

import {
  Bell,
  FileText,
  Folder,
  MessageSquare,
  MessagesSquare,
  Receipt,
  ShoppingCart,
  Ticket,
  UserPlus,
  WalletCards,
  X,
} from "lucide-react";
import { GlobalSearch } from "./global-search";
import { DashboardDateTrigger } from "../dashboard/dashboard-date-trigger";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
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
import { notificationPollDelay, NOTIFICATION_POLL_TICK_MS } from "../../domain/notifications/polling";
import { useTicketCacheRevocation } from "../tickets/use-ticket-cache-revocation";
import { notificationVisibleWithModules } from "../../domain/notifications/visibility";
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
import {
  TeamMessagesTrigger,
} from "../team/team-messages-trigger";
import { MobileTeamMessagesLever } from "../team/mobile-team-messages-lever";
import { useTeamMessagesChat } from "../team/use-team-messages-chat";
import { useHeaderOverlay } from "./use-header-overlay";
import { TenantBrandingScope } from "./tenant-branding-provider";

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
                    : category === "team"
                      ? MessagesSquare
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
  notificationSoundEnabled = true,
  mobileNavigation,
}: {
  user: InternalUser;
  /**
   * The profile's stored chime preference. Defaults to on, matching the
   * column default, so a missing prop is never a silent behaviour change.
   */
  notificationSoundEnabled?: boolean;
  mobileNavigation?: ReactNode;
}) {
  /*
   * Lifted here (rather than owned inside TeamMessagesTrigger) so the
   * desktop header button and the mobile edge lever can both drive the same
   * open/unread state -- and therefore the same single <TeamMessagesDrawer>
   * mount -- regardless of which one is visible at the current breakpoint.
   */
  const chat = useTeamMessagesChat(user);
  const projectsAvailable = user.modules?.projects === true;
  const projectsAvailableRef = useRef(projectsAvailable);
  useEffect(() => { projectsAvailableRef.current = projectsAvailable; }, [projectsAvailable]);
  const ticketsAvailable = user.modules?.tickets === true && user.tickets?.view === true;
  const ticketsAvailableRef = useRef(ticketsAvailable);
  useEffect(() => { ticketsAvailableRef.current = ticketsAvailable; }, [ticketsAvailable]);

  const triggerRef =
    useRef<HTMLButtonElement>(null);

  const panelRef =
    useRef<HTMLElement>(null);

  const mounted =
    useSyncExternalStore(
      () => () => {},
      () => true,
      () => false,
    );

  const [
    cachedNotifications,
    setNotifications,
  ] = useState<
    WalletNotificationItem[]
  >([]);
  const notifications = cachedNotifications.filter((item) => notificationVisibleWithModules(item, ticketsAvailable, projectsAvailable));

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

  const cacheGeneration = useRef(0);
  useTicketCacheRevocation(() => {
    setNotifications((items) => items.filter((item) => notificationVisibleWithModules(item, false, true)));
    setNotificationRinging(false);
  }, cacheGeneration);

  const notificationSeenIdsRef =
    useRef<Set<string>>(
      new Set(),
    );

  /*
   * The profile's chime preference, read at fire time rather than at schedule
   * time. Same shape as `ClientNotificationBell`'s ref, and synced in an
   * effect because a render must not write it.
   */
  const soundEnabledRef =
    useRef(
      notificationSoundEnabled,
    );

  useEffect(
    () => {
      soundEnabledRef.current =
        notificationSoundEnabled;
    },
    [notificationSoundEnabled],
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
  const notificationLoadInFlightRef = useRef(false);
  const notificationRefreshPendingRef = useRef(false);
  const notificationPollRef = useRef({ open: notificationsOpen, failures: 0, nextAt: 0 });

  useEffect(() => {
    const poll = notificationPollRef.current;
    poll.open = notificationsOpen;
    poll.nextAt = Date.now() + notificationPollDelay(poll.open, poll.failures);
  }, [notificationsOpen]);

  const noteIncomingNotifications =
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
          (item, index) => {
            const startTimer =
              window.setTimeout(
                () => {
                  /*
                   * Read at fire time, not schedule time: up to 680ms per
                   * item passes between a notification arriving and its
                   * staggered chime, and the timer must see the current
                   * value rather than the one captured when it was set.
                   */
                  if (
                    soundEnabledRef.current && notificationVisibleWithModules(item, ticketsAvailableRef.current, projectsAvailableRef.current)
                    && (generation === cacheGeneration.current || notificationVisibleWithModules(item, false, true))
                  ) {
                    playNotificationChime();
                  }
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
      async function loadNotifications(
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

        if (notificationLoadInFlightRef.current) {
          if (!silent || queueIfBusy) notificationRefreshPendingRef.current = true;
          return;
        }
        notificationLoadInFlightRef.current = true;

        if (!silent) {
          setNotificationsLoading(
            true,
          );
        }

        const generation = cacheGeneration.current;
        try {
          const result =
            await getWalletNotificationsAction();
          notificationPollRef.current.failures = result.ok ? 0 : Math.min(notificationPollRef.current.failures + 1, 7);

          if (
            isActive &&
            !isActive()
          ) {
            return;
          }

          if (result.ok) {
            const items = generation === cacheGeneration.current ? result.notifications
              : result.notifications.filter((item) => notificationVisibleWithModules(item, false, true));
            noteIncomingNotifications(
              items,
            );

            setNotifications(
              items,
            );

            setNotificationsError(
              null,
            );
          } else if (!silent) {
            setNotificationsError(
              result.error,
            );
          }

        } catch {
          notificationPollRef.current.failures = Math.min(notificationPollRef.current.failures + 1, 7);
          if (!silent && (!isActive || isActive())) {
            setNotificationsError("Unable to load notifications.");
          }
        } finally {
          if (!silent && (!isActive || isActive())) {
            setNotificationsLoading(false);
          }
          notificationLoadInFlightRef.current = false;
          const poll = notificationPollRef.current;
          poll.nextAt = Date.now() + notificationPollDelay(poll.open, poll.failures);
          const refreshPending = notificationRefreshPendingRef.current;
          notificationRefreshPendingRef.current = false;
          if (refreshPending && !document.hidden) {
            void loadNotifications(true);
          }
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
    let active = true;

    void Promise.resolve().then(
      () =>
        loadNotifications(
          false,
          () => active,
        ),
    );

    return () => {
      active = false;
    };
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
    // The local tick checks the deadline; a closed bell fetches only once a minute.
    const refresh = () => {
      if (!document.hidden && navigator.onLine && Date.now() >= notificationPollRef.current.nextAt) {
        void loadNotifications(
          true,
        );
      }
    };
    const refreshOnReturn = () => {
      if (!document.hidden) void loadNotifications(true, undefined, true);
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
      notificationRefreshPendingRef.current = false;
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

  useHeaderOverlay(
    "notifications",
    notificationsOpen,
    () => setNotificationsOpen(false),
  );

  /*
   * Mobile scroll morph (<=767px, see globals.css): flat/integrated at the
   * top of the page, a compact floating pill past SCROLL_THRESHOLD. Desktop
   * ignores `data-scrolled` entirely, so this listener is harmless there.
   */
  const SCROLL_THRESHOLD = 12;

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;

    const evaluate = () => {
      ticking = false;
      setScrolled(window.scrollY > SCROLL_THRESHOLD);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(evaluate);
    };

    evaluate();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
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
    <>
      {/* Mobile-only dim backdrop; hidden on desktop where the panel is a
          plain anchored popover. Reuses the same open state as the panel
          itself, so there is one source of truth for both. */}
      <button
        type="button"
        className={
          notificationsOpen
            ? "workspace-notification-backdrop is-open"
            : "workspace-notification-backdrop"
        }
        aria-hidden={!notificationsOpen}
        tabIndex={-1}
        onClick={() => setNotificationsOpen(false)}
      />

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

            <button
              type="button"
              className="workspace-notification-close"
              aria-label="Close notifications"
              onClick={() => setNotificationsOpen(false)}
            >
              <X aria-hidden="true" size={16} />
            </button>
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
    </>
  );

  return (
    <>
      <div
        className="workspace-command-bar"
        aria-label="Workspace controls"
        data-scrolled={scrolled}
      >
        {mobileNavigation}
        <GlobalSearch ticketsAvailable={ticketsAvailable} projectsAvailable={projectsAvailable} />
        {/*
          Secondary utilities stay in the collapsible rail. The notification
          bell sits outside so unread counts remain visible at rest (KI-059),
          while Calendar / Team Messages / Quick Action keep hover/focus reveal.
          Order when expanded stays Calendar → Team → Bell → Quick Action.
        */}
        <div className="workspace-command-shortcuts workspace-command-secondary">
          <DashboardDateTrigger />
          {/*
            Team Messages. This slot held a dead "Gallery" placeholder that
            opened nothing; it is now internal staff-to-staff communication,
            and it renders only for an account holding team_messages.use.
            Desktop only -- mobile hides this wrapper (globals.css) and uses
            the right-edge lever below instead, both sharing `chat`.
          */}
          <TeamMessagesTrigger
            user={user}
            chat={chat}
          />
        </div>

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

        {user.role === "owner" || user.role === "admin" ? <div className="workspace-command-shortcuts workspace-command-create">
          <WorkspaceQuickAction
            user={user}
          />
        </div> : null}

        <div className="workspace-command-profile">
          <AccountMenu
            user={user}
          />
        </div>
      </div>

      {/* Mobile-only (globals.css / team-messages.module.css); shares
          `chat` with the desktop TeamMessagesTrigger above so there is
          still one drawer, one sync controller, regardless of breakpoint. */}
      <MobileTeamMessagesLever chat={chat} />

      {mounted
        ? createPortal(
            <TenantBrandingScope>{notificationPanel}</TenantBrandingScope>,
            document.body,
          )
        : null}
    </>
  );
}
