"use client";

import { VoiceAudioPlayer } from "../audio/voice-audio-player";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  TicketDetailMessage,
} from "../../domain/tickets/schema";
import type { TeamConversationView } from "../../domain/team/projections";
import { toTeamReactionViews } from "../../domain/team/projections";
import {
  formatDateTime,
} from "../../lib/format";
import {
  ticketActorLabel,
} from "../../lib/tickets/presentation";
import {
  TicketMessageAvatar,
} from "./ticket-message-avatar";
import styles from "./tickets.module.css";
import type { TicketMutationResult } from "../../app/actions/tickets";
import { OrderMessageActions, type OrderReplyTarget } from "./order-message-actions";
import { useBrowserTimeZone } from "../../lib/use-browser-time-zone";

function renderTicketInline(
  text: string,
): ReactNode[] {
  const tokenPattern =
    /(\*\*[^*\n]+\*\*|_[^_\n]+_|\[[^\]\n]+\]\((?:https?:\/\/|mailto:|tel:)[^)\s]+\))/g;

  return text
    .split(tokenPattern)
    .filter(
      (part) =>
        part.length > 0,
    )
    .map(
      (part, index) => {
        if (
          part.startsWith(
            "**",
          ) &&
          part.endsWith(
            "**",
          )
        ) {
          return (
            <strong key={index}>
              {renderTicketInline(
                part.slice(
                  2,
                  -2,
                ),
              )}
            </strong>
          );
        }

        if (
          part.startsWith(
            "_",
          ) &&
          part.endsWith(
            "_",
          )
        ) {
          return (
            <em key={index}>
              {renderTicketInline(
                part.slice(
                  1,
                  -1,
                ),
              )}
            </em>
          );
        }

        const link =
          part.match(
            /^\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)]+)\)$/,
          );

        if (link) {
          const linkLabel =
            link[1] ?? "";

          const href =
            link[2] ?? "";

          const external =
            href.startsWith(
              "http://",
            ) ||
            href.startsWith(
              "https://",
            );

          return (
            <a
              key={index}
              href={href}
              target={
                external
                  ? "_blank"
                  : undefined
              }
              rel={
                external
                  ? "noreferrer noopener"
                  : undefined
              }
            >
              {renderTicketInline(
                linkLabel,
              )}
            </a>
          );
        }

        return part;
      },
    );
}

function renderTicketBodyBlocks(
  body: string,
): ReactNode[] {
  const lines =
    body.split("\n");

  const blocks:
    ReactNode[] = [];

  let index = 0;

  while (
    index < lines.length
  ) {
    const line =
      lines[index] ?? "";

    if (
      line.startsWith(
        "# ",
      )
    ) {
      blocks.push(
        <h3
          key={`heading-${index}`}
        >
          {renderTicketInline(
            line.slice(2),
          )}
        </h3>,
      );

      index += 1;
      continue;
    }

    if (
      /^-\s+/.test(line)
    ) {
      const items:
        string[] = [];

      const start =
        index;

      while (
        index < lines.length
      ) {
        const match =
          (
            lines[index] ?? ""
          ).match(
            /^-\s+(.+)$/,
          );

        if (!match) {
          break;
        }

        items.push(
          match[1] ?? "",
        );

        index += 1;
      }

      blocks.push(
        <ul
          key={`ul-${start}`}
        >
          {items.map(
            (
              item,
              itemIndex,
            ) => (
              <li
                key={
                  itemIndex
                }
              >
                {renderTicketInline(
                  item,
                )}
              </li>
            ),
          )}
        </ul>,
      );

      continue;
    }

    if (
      /^\d+\.\s+/.test(
        line,
      )
    ) {
      const items:
        string[] = [];

      const start =
        index;

      while (
        index < lines.length
      ) {
        const match =
          (
            lines[index] ?? ""
          ).match(
            /^\d+\.\s+(.+)$/,
          );

        if (!match) {
          break;
        }

        items.push(
          match[1] ?? "",
        );

        index += 1;
      }

      blocks.push(
        <ol
          key={`ol-${start}`}
        >
          {items.map(
            (
              item,
              itemIndex,
            ) => (
              <li
                key={
                  itemIndex
                }
              >
                {renderTicketInline(
                  item,
                )}
              </li>
            ),
          )}
        </ol>,
      );

      continue;
    }

    blocks.push(
      <p
        key={`p-${index}`}
      >
        {line
          ? renderTicketInline(
              line,
            )
          : <br />}
      </p>,
    );

    index += 1;
  }

  return blocks;
}

function TicketMessageBody({
  body,
}: {
  body: string;
}) {
  return (
    <div
      className={
        styles.messageBody
      }
    >
      {renderTicketBodyBlocks(
        body,
      )}
    </div>
  );
}

export function chronologicalMessages(
  messages:
    TicketDetailMessage[],
) {
  return messages
    .map(
      (
        message,
        index,
      ) => ({
        message,
        index,
      }),
    )
    .sort(
      (left, right) => {
        const leftTime =
          Date.parse(
            left.message
              .created_at,
          );

        const rightTime =
          Date.parse(
            right.message
              .created_at,
          );

        if (
          Number.isFinite(
            leftTime,
          ) &&
          Number.isFinite(
            rightTime,
          ) &&
          leftTime !==
            rightTime
        ) {
          return (
            leftTime -
            rightTime
          );
        }

        return (
          left.index -
          right.index
        );
      },
    )
    .map(
      ({ message }) =>
        message,
    );
}

function isInternalActorSide(
  authorType: TicketDetailMessage["author_type"],
): boolean {
  return authorType === "internal" || authorType === "system";
}

/**
 * "￼" is the canonical placeholder the backend writes for `body` when a
 * client sends an attachment with no text (see
 * app_send_ticket_message_with_attachment's `send_body := U&'\FFFC'`) — a
 * blank/whitespace-only body reaching here means no visible text either way.
 */
function hasVisibleText(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length > 0 && trimmed !== "￼";
}

/** A message renders as bare media (no bubble chrome) only when it has no
 * visible text and every attachment is an image — a single non-image file
 * still needs the file-card treatment, so it keeps the normal bubble. */
export function isBareImageMessage(message: TicketDetailMessage): boolean {
  return (
    !hasVisibleText(message.body) &&
    message.attachments.length > 0 &&
    message.attachments.every((attachment) => attachment.mime_type.startsWith("image/"))
  );
}

/** A truthful Reply-context label: real text when present, otherwise a
 * media-aware word instead of surfacing the raw "￼" placeholder body. */
export function replyPreviewText(message: TicketDetailMessage): string {
  if (hasVisibleText(message.body)) return message.body;
  if (message.attachments.length === 0) return message.body;
  const allImages = message.attachments.every((attachment) => attachment.mime_type.startsWith("image/"));
  return allImages ? "Image" : "Attachment";
}

/** The exact attachment a reply should target, from the message being
 * replied to. Only set when that message has exactly one attachment — the
 * only shape the current single-attachment send pipeline can produce; a
 * message with 0 or 2+ attachments falls back to the generic text/"Image"/
 * "Attachment" quote instead of guessing which attachment was meant. */
export function replyAttachmentTarget(
  message: TicketDetailMessage,
): { id: string; isImage: boolean; originalName: string } | null {
  const attachment = message.attachments.length === 1 ? message.attachments[0] : undefined;
  if (!attachment) return null;
  return {
    id: attachment.id,
    isImage: attachment.mime_type.startsWith("image/"),
    originalName: attachment.original_name,
  };
}

/** In-app viewer for a tapped attachment image — keeps the user on the
 * current page instead of navigating to the authenticated download route
 * or the signed Storage URL it redirects to. */
const focusableSelector =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A real application-level modal: the rest of the page is marked `inert`
 * (unreachable by pointer, keyboard, or screen reader) and body scroll is
 * locked for as long as the lightbox is mounted, so the conversation, Ticket
 * selection and Details cannot be operated underneath it -- restored exactly
 * once, on unmount, regardless of which of those state changes fired first.
 */
function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const inertedSiblings: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child.contains(cardRef.current) || child === cardRef.current) continue;
      if (!child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        inertedSiblings.push(child);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(
        cardRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const sibling of inertedSiblings) sibling.removeAttribute("inert");
    };
  }, [onClose]);

  return createPortal(
    <div className={styles.imageLightboxBackdrop} onClick={onClose}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        className={styles.imageLightboxCard}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Close image"
          className={styles.imageLightboxClose}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated per-message download route, not a static-optimizable asset */}
        <img src={src} alt={alt} className={styles.imageLightboxImage} />
      </div>
    </div>,
    document.body,
  );
}

export function TicketConversation({
  messages,
  clientView = false,
  heading = "Conversation",
  headerActions,
  hideInternalNotes = false,
  orderChat = false,
  viewerProfileId,
  forwardDestinations = [],
  sourceLabel = "Project",
  onReply,
  canReact = false,
  onToggleReaction,
  onRetryMessage,
}: {
  messages:
    TicketDetailMessage[];
  clientView?: boolean;
  heading?: ReactNode;
  headerActions?: ReactNode;
  hideInternalNotes?: boolean;
  orderChat?: boolean;
  viewerProfileId?: string;
  forwardDestinations?: TeamConversationView[];
  sourceLabel?: string;
  onReply?: (message: OrderReplyTarget) => void;
  canReact?: boolean;
  /** Acting context for reactions; defaults to the staff server action. */
  onToggleReaction?: (messageId: string, reactionCode: string) => Promise<TicketMutationResult>;
  onRetryMessage?: (message: TicketDetailMessage) => void;
}) {
  const timeZone = useBrowserTimeZone();
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const lightboxTriggerRef = useRef<HTMLButtonElement | null>(null);

  const visibleMessages =
    chronologicalMessages(
      messages.filter(
        (message) => {
          if (clientView) {
            return (
              message.visibility ===
                "client" &&
              message.message_kind !==
                "internal_note"
            );
          }

          if (hideInternalNotes || orderChat) {
            return (
              message.visibility === "client" && message.message_kind !==
              "internal_note"
            );
          }

          return true;
        },
      ),
    );

  return (
    <section
      className={
        `${styles.conversation}${orderChat ? ` ${styles.orderChat}` : ""}`
      }
      data-client-view={clientView || undefined}
      aria-label="Conversation"
    >
      <header>
        <div>
          <MessageSquareText
            aria-hidden="true"
          />

          <div>
            <h2>
              {heading}
            </h2>


          </div>
        </div>

        {headerActions && !clientView ? (
          <div
            className={
              styles.conversationHeaderActions
            }
          >
            {headerActions}
          </div>
        ) : null}
      </header>

      {visibleMessages.length ===
      0 ? (
        <div
          className={
            styles.emptyConversation
          }
        >
          <p>
            No conversation
            yet.
          </p>
        </div>
      ) : (
        <ol
          className={
            styles.thread
          }
        >
          {visibleMessages.map(
            (message, index) => {
              const internalNote =
                message.message_kind ===
                "internal_note";

              const sender =
                ticketActorLabel(
                  message.author_type,
                  message.author_name,
                );

              const authorSide =
                isInternalActorSide(
                  message.author_type,
                )
                  ? "internal"
                  : "client";
              /*
               * Ownership is the authenticated profile id, never the author's
               * role: the signed-in user's messages sit right, everyone
               * else's left, in both POVs. Another staff member is not "me"
               * even though they write on the same internal side.
               *
               * The legacy Ticket read model deliberately withholds every
               * author_profile_id from a client actor (see
               * app_get_ticket_detail), and a legacy Ticket has exactly one
               * client party -- so when no id is present, a client viewer's
               * own messages are exactly author_type "client" (never
               * "guest"/"system"). Native Project conversations and every
               * staff POV carry the ids and take the id comparison.
               */
              const ownMessage = viewerProfileId && message.author_profile_id
                ? message.author_profile_id === viewerProfileId
                : clientView && message.author_type === "client";
              /*
               * `data-side` is the RENDERED side, not the author's role:
               * "internal" always selects the right-hand own-message skin and
               * "client" the left-hand other-party one, for staff and client
               * viewers alike. The client-view rules mirror the pair, so
               * every side-keyed style (bubble, avatar column, sender
               * direction, action-menu anchor) follows the viewer's
               * perspective for free. `data-own` keeps the raw ownership
               * fact for tests and future callers. A caller that supplies
               * neither a viewer id nor `clientView` keeps the legacy
               * author-side attribute (the plain non-chat feed).
               */
              const renderedSide = viewerProfileId || clientView
                ? ownMessage === clientView ? "client" : "internal"
                : authorSide;
              const previous = visibleMessages[index - 1];
              const grouped = Boolean(previous && message.author_profile_id &&
                previous.author_profile_id === message.author_profile_id &&
                previous.author_type === message.author_type &&
                Date.parse(message.created_at) - Date.parse(previous.created_at) <= 300_000);
              /*
               * Identity belongs to the OTHER party, never to me. A staff
               * viewer needs it to tell which client wrote what; a client
               * viewer needs it to see that the message came from Wolf Forge.
               * Either way it is never rendered above a viewer's own bubble --
               * repeating your own name and avatar above every message you
               * send costs height and says nothing. System messages are never
               * own, so they keep the other-party identity and stay neutral.
               */
              const showOtherIdentity = orderChat && !ownMessage;
              const showIdentityTime = showOtherIdentity && !grouped;
              const bareImageMessage = isBareImageMessage(message);

              return (
                <li
                  key={message.id}
                  data-side={renderedSide}
                  data-grouped={orderChat && grouped ? "true" : undefined}
                  data-own={orderChat && ownMessage ? "true" : undefined}
                  className={
                    internalNote
                      ? styles.internalMessage
                      : styles.message
                  }
                >
                  <div
                    className={
                      styles.messageLayout
                    }
                  >
                    {orderChat ? (
                      showOtherIdentity ? (
                        grouped ? (
                          <span
                            className={styles.messageAvatar}
                            aria-hidden="true"
                            style={{ visibility: "hidden" }}
                          />
                        ) : (
                          <TicketMessageAvatar
                            src={message.author_avatar_url}
                            name={sender}
                          />
                        )
                      ) : null
                    ) : (
                      <TicketMessageAvatar
                        src={
                          message.author_avatar_url
                        }
                      />
                    )}

                    <div
                      className={
                        styles.messageContent
                      }
                    >
                      {!orderChat || (!ownMessage && !grouped) ? <div
                        className={
                          styles.messageSender
                        }
                      >
                        <strong>
                          {sender}
                        </strong>

                        {internalNote ? (
                          <span>
                            <LockKeyhole
                              aria-hidden="true"
                            />
                            Internal note
                          </span>
                        ) : null}
                      </div> : null}

                      {showIdentityTime ? (
                        <time
                          className={styles.messageIdentityTime}
                          dateTime={message.created_at}
                        >
                          {formatDateTime(message.created_at, timeZone)}
                        </time>
                      ) : null}

                      <div className={styles.messageStack}>
                        <div
                          tabIndex={orderChat ? 0 : undefined}
                          className={
                            `${styles.messageBubble}${bareImageMessage ? ` ${styles.bareMediaBubble}` : ""}${message.pending ? ` ${styles.messagePending}` : ""}${message.failed ? ` ${styles.messageFailed}` : ""}`
                          }
                        >
                        {message.reply_to_message_id ? (
                          <div className={styles.messageReplyPreview}>
                            <strong>
                              {message.reply_source_available === false
                                ? "Original message unavailable"
                                : message.reply_source_author_name?.trim() || "Message"}
                            </strong>
                            {message.reply_source_available !== false && message.reply_source_attachment?.is_image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/ticket-attachments/${message.reply_source_attachment.id}`}
                                alt=""
                                className={styles.messageReplyThumbnail}
                              />
                            ) : message.reply_source_available !== false && message.reply_source_attachment ? (
                              <p>{message.reply_source_attachment.original_name}</p>
                            ) : message.reply_source_available !== false && message.reply_quote_text ? (
                              <p>{message.reply_quote_text}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {bareImageMessage ? null : (
                          <TicketMessageBody
                            body={
                              message.body
                            }
                          />
                        )}

                        {message
                          .attachments
                          .length >
                        0 ? (
                          <ul
                            className={
                              styles.attachments
                            }
                          >
                            {message.attachments.map(
                              (
                                attachment,
                              ) => {
                                const isImage = attachment.mime_type.startsWith("image/");
                                const attachmentUrl = `/api/ticket-attachments/${attachment.id}`;
                                return (
                                <li
                                  key={
                                    attachment.id
                                  }
                                  className={isImage ? styles.attachmentImageCard : undefined}
                                >
                                  {isImage ? (
                                    <button
                                      type="button"
                                      className={styles.attachmentLink}
                                      onClick={(event) => {
                                        lightboxTriggerRef.current = event.currentTarget;
                                        setLightbox({ src: attachmentUrl, alt: attachment.original_name });
                                      }}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated per-message download route, not a static-optimizable asset */}
                                      <img
                                        className={styles.attachmentImage}
                                        src={attachmentUrl}
                                        alt={attachment.original_name}
                                      />
                                    </button>
                                  ) : attachment.mime_type.startsWith("audio/") ? (
                                    <VoiceAudioPlayer key={attachment.id} source={attachmentUrl} />
                                  ) : (
                                    <a
                                      className={styles.attachmentLink}
                                      href={attachmentUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <FileText aria-hidden="true" />
                                      <span>
                                        <strong>{attachment.original_name}</strong>
                                        <small>
                                          {attachment.mime_type} {String.fromCharCode(183)}{" "}
                                          {attachment.size_bytes.toLocaleString()} bytes
                                        </small>
                                      </span>
                                    </a>
                                  )}
                                </li>
                                );
                              },
                            )}
                          </ul>
                        ) : null}

                        </div>

                        {orderChat && !message.pending && !message.failed ? (
                          <OrderMessageActions
                            message={{
                              messageId: message.id,
                              ticketId: message.ticket_id,
                              authorName: sender,
                              body: message.body,
                              replyPreview: replyPreviewText(message),
                              replyAttachment: replyAttachmentTarget(message),
                            }}
                            sourceLabel={sourceLabel}
                            reactions={toTeamReactionViews(message.reactions)}
                            destinations={forwardDestinations}
                            onReply={onReply}
                            canReact={canReact}
                            onToggleReaction={onToggleReaction}
                          />
                        ) : null}
                      </div>

                      {message.failed ? (
                        <button
                          type="button"
                          className={styles.messageRetry}
                          onClick={() => onRetryMessage?.(message)}
                        >
                          <RotateCcw aria-hidden="true" />
                          Not sent · Retry
                        </button>
                      ) : message.pending ? (
                        <span className={styles.messagePendingStatus} aria-live="polite">
                          <Loader2 className={styles.pendingSpin} aria-hidden="true" />
                          Sending…
                        </span>
                      ) : !showIdentityTime ? (
                        <time
                          className={
                            styles.messageTime
                          }
                          dateTime={
                            message.created_at
                          }
                        >
                          {formatDateTime(
                            message.created_at,
                            timeZone,
                          )}
                        </time>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            },
          )}
        </ol>
      )}
      {lightbox ? (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => {
            setLightbox(null);
            lightboxTriggerRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
