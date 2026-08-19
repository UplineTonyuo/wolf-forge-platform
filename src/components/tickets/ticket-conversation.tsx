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

function chronologicalMessages(
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

export function TicketConversation({
  messages,
  clientView = false,
}: {
  messages:
    TicketDetailMessage[];
  clientView?: boolean;
}) {
  const visibleMessages =
    chronologicalMessages(
      messages.filter(
        (message) =>
          !clientView ||
          (
            message.visibility ===
              "client" &&
            message.message_kind !==
              "internal_note"
          ),
      ),
    );

  return (
    <section
      className={
        styles.conversation
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
              Conversation
            </h2>


          </div>
        </div>
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
            (message) => {
              const internalNote =
                message.message_kind ===
                "internal_note";

              const sender =
                ticketActorLabel(
                  message.author_type,
                  message.author_name,
                );

              return (
                <li
                  key={message.id}
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
                    <TicketMessageAvatar
                      src={
                        message.author_avatar_url
                      }
                    />

                    <div
                      className={
                        styles.messageContent
                      }
                    >
                      <header>
                        <div
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
                        </div>

                        <time
                          dateTime={
                            message.created_at
                          }
                        >
                          {formatDateTime(
                            message.created_at,
                          )}
                        </time>
                      </header>

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
                                <FileText
                                  aria-hidden="true"
                                />

                                <strong>
                                  {
                                    attachment.original_name
                                  }
                                </strong>

                                <small>
                                  {
                                    attachment.mime_type
                                  }
                                  {" Â· "}
                                  {attachment.size_bytes.toLocaleString()}
                                  {" bytes"}
                                </small>
                              </li>
                            ),
                          )}
                        </ul>
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