import type {
  ReactNode,
} from "react";
import {
  FileText,
  LockKeyhole,
  MessageSquareText,
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
import { OrderMessageActions, type OrderReplyTarget } from "./order-message-actions";

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
}) {
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

              const side =
                isInternalActorSide(
                  message.author_type,
                )
                  ? "internal"
                  : "client";
              const ownMessage = !clientView && side === "internal" &&
                Boolean(viewerProfileId) && message.author_profile_id === viewerProfileId;
              const previous = visibleMessages[index - 1];
              const grouped = Boolean(previous && message.author_profile_id &&
                previous.author_profile_id === message.author_profile_id &&
                previous.author_type === message.author_type &&
                Date.parse(message.created_at) - Date.parse(previous.created_at) <= 300_000);
              const showClientIdentity = orderChat && side === "client";
              const showIdentityTime = showClientIdentity && !grouped;

              return (
                <li
                  key={message.id}
                  data-side={side}
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
                      showClientIdentity ? (
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
                          {formatDateTime(message.created_at)}
                        </time>
                      ) : null}

                      <div className={styles.messageStack}>
                        <div
                          tabIndex={orderChat ? 0 : undefined}
                          className={
                            styles.messageBubble
                          }
                        >
                        {message.reply_to_message_id ? (
                          <div className={styles.messageReplyPreview}>
                            <strong>
                              {message.reply_source_available === false
                                ? "Original message unavailable"
                                : message.reply_source_author_name?.trim() || "Message"}
                            </strong>
                            {message.reply_source_available !== false && message.reply_quote_text ? (
                              <p>{message.reply_quote_text}</p>
                            ) : null}
                          </div>
                        ) : null}
                        <TicketMessageBody
                          body={
                            message.body
                          }
                        />

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
                              ) => (
                                <li
                                  key={
                                    attachment.id
                                  }
                                >
                                  <a
                                    className={styles.attachmentLink}
                                    href={`/api/ticket-attachments/${attachment.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {attachment.mime_type.startsWith("image/") ? (
                                      // eslint-disable-next-line @next/next/no-img-element -- authenticated per-message download route, not a static-optimizable asset
                                      <img
                                        className={styles.attachmentImage}
                                        src={`/api/ticket-attachments/${attachment.id}`}
                                        alt={attachment.original_name}
                                      />
                                    ) : (
                                      <FileText aria-hidden="true" />
                                    )}
                                    <span>
                                      <strong>{attachment.original_name}</strong>
                                      <small>
                                        {attachment.mime_type} {String.fromCharCode(183)}{" "}
                                        {attachment.size_bytes.toLocaleString()} bytes
                                      </small>
                                    </span>
                                  </a>
                                </li>
                              ),
                            )}
                          </ul>
                        ) : null}

                        </div>

                        {orderChat ? (
                          <OrderMessageActions
                            message={{
                              messageId: message.id,
                              ticketId: message.ticket_id,
                              authorName: sender,
                              body: message.body,
                            }}
                            sourceLabel={sourceLabel}
                            reactions={toTeamReactionViews(message.reactions)}
                            destinations={forwardDestinations}
                            onReply={onReply}
                            canReact={canReact}
                          />
                        ) : null}
                      </div>

                      {!showIdentityTime ? (
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
    </section>
  );
}
