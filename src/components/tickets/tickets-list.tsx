"use client";

import { useRouteTransitionPush } from "../shell/route-transition";

import { createInternalTicketAction } from "../../app/actions/tickets";

import { Bold, Filter, Heading1, Italic, Link2, Plus, Redo2, Search, TicketIcon, Undo2, X } from "lucide-react";
import { RouteTransitionLink as Link } from "../shell/route-transition";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { TicketSummary } from "../../domain/tickets/schema";
import { formatDateTime } from "../../lib/format";
import { ticketPriorityOptions } from "../../lib/tickets/presentation";
import { TicketPriorityBadge, TicketStatusBadge } from "./ticket-badges";
import { TicketsFilterPanel, TicketsFilterSheet, type InboxFilter } from "./tickets-filter-panel";
import styles from "./tickets.module.css";

export function TicketsList({
  summaries,
  companies = [],
  canCreate = false,
}: {
  summaries: TicketSummary[];
  companies?: Array<{
    id: string;
    name: string;
  }>;
  canCreate?: boolean;
}) {
  const router = useRouter();
  const push = useRouteTransitionPush();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
    const [priority, setPriority] = useState("all");
  const [inbox, setInbox] = useState<InboxFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const filterAreaRef = useRef<HTMLDivElement>(null);

  const ticketDialogRef =
    useRef<HTMLDialogElement>(null);

  const [selectedCompanyId, setSelectedCompanyId] =
    useState("");

  const [companyQuery, setCompanyQuery] =
    useState("");

  const [companyPickerOpen, setCompanyPickerOpen] =
    useState(false);

  const [ticketSubject, setTicketSubject] =
    useState("");

  const [ticketMessage, setTicketMessage] =
    useState("");

  const ticketMessageRef =
    useRef<HTMLDivElement>(null);

  const ticketLinkRangeRef =
    useRef<Range | null>(null);

  const [ticketLinkOpen, setTicketLinkOpen] =
    useState(false);

  const [ticketLinkUrl, setTicketLinkUrl] =
    useState("https://");

  const [ticketPriority, setTicketPriority] =
    useState("normal");

  const [ticketPriorityOpen, setTicketPriorityOpen] =
    useState(false);

  const [creatingTicket, setCreatingTicket] =
    useState(false);

  const [createTicketError, setCreateTicketError] =
    useState<string | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      /* The mobile sheet portals to `document.body`, outside the toolbar, so
         its own clicks would otherwise read as "outside" and close it. */
      if (mobileFilters) return;

      if (
        target instanceof Node &&
        filterAreaRef.current &&
        !filterAreaRef.current.contains(target)
      ) {
        setFilterOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFilterOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileFilters]);

  /* The list already switches to its mobile toolbar at 800px, so the Filter
     button opens the same sheet the rest of Wolf Forge uses below that. */
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mobile = window.matchMedia("(max-width: 800px)");
    const sync = () => setMobileFilters(mobile.matches);

    sync();
    mobile.addEventListener("change", sync);
    return () => mobile.removeEventListener("change", sync);
  }, []);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return summaries.filter((ticket) => {
      const searchable = [ticket.public_ref, ticket.subject, ticket.company_name, ticket.client_name, ticket.assigned_to_name].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!term || searchable.includes(term)) && (status === "all" || ticket.status === status) && (priority === "all" || ticket.priority === priority) && (inbox === "all" || (inbox === "in" ? Boolean(ticket.inbox_added_at) : !ticket.inbox_added_at));
    });
  }, [inbox, priority, query, status, summaries]);

  const activeFilterCount =
    Number(status !== "all") +
    Number(priority !== "all") +
    Number(inbox !== "all");

  /* Filters only -- the Ticket search is deliberately left standing. */
  function clearTicketFilters() {
    setStatus("all");
    setPriority("all");
    setInbox("all");
  }

  // WF TICKET WYSIWYG START

  function serializeTicketEditorNode(
    node: Node,
  ): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (!(node instanceof HTMLElement)) {
      return "";
    }

    const tag =
      node.tagName.toLowerCase();

    const inner =
      Array.from(node.childNodes)
        .map(serializeTicketEditorNode)
        .join("");

    if (
      tag === "strong" ||
      tag === "b"
    ) {
      return inner
        ? `**${inner}**`
        : "";
    }

    if (
      tag === "em" ||
      tag === "i"
    ) {
      return inner
        ? `_${inner}_`
        : "";
    }

    if (tag === "a") {
      const href =
        node.getAttribute("href")?.trim();

      return href && inner
        ? `[${inner}](${href})`
        : inner;
    }

    if (
      tag === "h1" ||
      tag === "h2" ||
      tag === "h3"
    ) {
      const heading =
        inner.trim();

      return heading
        ? `# ${heading}\n`
        : "";
    }

    if (tag === "br") {
      return "\n";
    }

    if (
      tag === "div" ||
      tag === "p"
    ) {
      return `${inner}\n`;
    }

    return inner;
  }


  function readTicketEditorValue() {
    const editor =
      ticketMessageRef.current;

    if (!editor) return "";

    return Array
      .from(editor.childNodes)
      .map(serializeTicketEditorNode)
      .join("")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }


  function syncTicketEditorValue() {
    const next =
      readTicketEditorValue();

    if (next.length > 50_000) {
      document.execCommand(
        "undo",
      );

      return;
    }

    setTicketMessage(next);
  }


  function runTicketEditorCommand(
    command: string,
    value?: string,
  ) {
    const editor =
      ticketMessageRef.current;

    if (!editor) return;

    editor.focus();

    document.execCommand(
      command,
      false,
      value,
    );

    requestAnimationFrame(
      syncTicketEditorValue,
    );
  }


  function saveTicketEditorSelection() {
    const editor =
      ticketMessageRef.current;

    const selection =
      window.getSelection();

    if (
      !editor ||
      !selection ||
      selection.rangeCount === 0
    ) {
      return;
    }

    const range =
      selection.getRangeAt(0);

    if (
      !editor.contains(
        range.commonAncestorContainer,
      )
    ) {
      return;
    }

    ticketLinkRangeRef.current =
      range.cloneRange();
  }


  function openTicketLinkPopover() {
    saveTicketEditorSelection();

    setTicketLinkUrl(
      "https://",
    );

    setTicketLinkOpen(true);
  }


  function closeTicketLinkPopover() {
    setTicketLinkOpen(false);

    setTicketLinkUrl(
      "https://",
    );

    ticketLinkRangeRef.current =
      null;
  }


  function applyTicketLink() {
    const editor =
      ticketMessageRef.current;

    if (!editor) return;

    const raw =
      ticketLinkUrl.trim();

    if (!raw) return;

    let href: string;

    try {
      const url =
        new URL(
          raw,
          window.location.origin,
        );

      if (
        ![
          "http:",
          "https:",
          "mailto:",
          "tel:",
        ].includes(url.protocol)
      ) {
        return;
      }

      href =
        url.href;
    } catch {
      return;
    }

    editor.focus();

    const selection =
      window.getSelection();

    const savedRange =
      ticketLinkRangeRef.current;

    if (
      selection &&
      savedRange
    ) {
      selection.removeAllRanges();

      selection.addRange(
        savedRange,
      );
    }

    const currentRange =
      selection?.rangeCount
        ? selection.getRangeAt(0)
        : null;

    if (
      currentRange &&
      currentRange.collapsed
    ) {
      const anchor =
        document.createElement(
          "a",
        );

      anchor.href =
        href;

      anchor.textContent =
        href;

      currentRange.insertNode(
        anchor,
      );

      currentRange.setStartAfter(
        anchor,
      );

      currentRange.collapse(
        true,
      );

      selection?.removeAllRanges();

      selection?.addRange(
        currentRange,
      );
    } else {
      document.execCommand(
        "createLink",
        false,
        href,
      );
    }

    closeTicketLinkPopover();

    requestAnimationFrame(
      syncTicketEditorValue,
    );
  }


  function pasteTicketPlainText(
    event: {
      preventDefault: () => void;
      clipboardData: DataTransfer;
    },
  ) {
    event.preventDefault();

    document.execCommand(
      "insertText",
      false,
      event.clipboardData.getData(
        "text/plain",
      ),
    );

    requestAnimationFrame(
      syncTicketEditorValue,
    );
  }

  // WF TICKET WYSIWYG END

  const companySuggestions = companies
    .filter((company) => {
      const term =
        companyQuery
          .trim()
          .toLocaleLowerCase();

      return (
        !term ||
        company.name
          .toLocaleLowerCase()
          .includes(term)
      );
    })
    .sort((a, b) => {
      const term =
        companyQuery
          .trim()
          .toLocaleLowerCase();

      const aName =
        a.name.toLocaleLowerCase();

      const bName =
        b.name.toLocaleLowerCase();

      const aStarts =
        term && aName.startsWith(term)
          ? 0
          : 1;

      const bStarts =
        term && bName.startsWith(term)
          ? 0
          : 1;

      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);

  function openTicketDialog() {
    setFilterOpen(false);
    setCreateTicketError(null);
    ticketDialogRef.current?.showModal();
  }

  function resetTicketDraft() {
    setSelectedCompanyId("");
    setCompanyQuery("");
    setCompanyPickerOpen(false);
    setTicketSubject("");
    setTicketMessage("");

    if (ticketMessageRef.current) {
      ticketMessageRef.current.innerHTML = "";
    }

    setTicketLinkOpen(false);
    setTicketLinkUrl("https://");
    ticketLinkRangeRef.current = null;

    setTicketPriority("normal");
    setTicketPriorityOpen(false);
    setCreateTicketError(null);
    setCreatingTicket(false);
  }

  async function submitInternalTicket(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !selectedCompanyId ||
      !ticketSubject.trim() ||
      !ticketMessage.trim()
    ) {
      setCreateTicketError(
        "Choose a client and complete the Subject and Message.",
      );
      return;
    }

    setCreatingTicket(true);
    setCreateTicketError(null);

    const result =
      await createInternalTicketAction({
        requestId: crypto.randomUUID(),
        companyId: selectedCompanyId,
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
        priority: ticketPriority,
      });

    if (!result.ok) {
      setCreatingTicket(false);
      setCreateTicketError(result.error);
      return;
    }

    ticketDialogRef.current?.close();

    push(
      `/tickets/${result.ticketId}?created=1`,
    );

    router.refresh();
  }
  return (
    <section className={styles.listSurface} aria-label="Tickets">

      <div className={styles.listToolbar} ref={filterAreaRef}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" />
          <span className="sr-only">Search Tickets</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ticket ID or person..."
          />
        </label>
        <button
          type="button"
          className={
            filterOpen && !mobileFilters
              ? styles.filterButtonActive
              : styles.filterButton
          }
          aria-expanded={filterOpen}
          onClick={() =>
            setFilterOpen((current) => !current)
          }
        >
          <Filter size={15} aria-hidden="true" />
          Filter
          {activeFilterCount > 0 ? (
            <span className={styles.filterCount}>
              {activeFilterCount}
            </span>
          ) : null}
        </button>
        {canCreate ? (
          <button
            type="button"
            className={styles.addTicketButton}
            onClick={openTicketDialog}
          >
            <Plus size={16} aria-hidden="true" />
            Add ticket
          </button>
        ) : null}

        {filterOpen && !mobileFilters ? (
          <TicketsFilterPanel
            status={status}
            priority={priority}
            inbox={inbox}
            onStatusChange={setStatus}
            onPriorityChange={setPriority}
            onInboxChange={setInbox}
            onClear={clearTicketFilters}
            onApply={() => setFilterOpen(false)}
          />
        ) : null}
      </div>

      <TicketsFilterSheet
        open={filterOpen && mobileFilters}
        onClose={() => setFilterOpen(false)}
        status={status}
        priority={priority}
        inbox={inbox}
        onStatusChange={setStatus}
        onPriorityChange={setPriority}
        onInboxChange={setInbox}
        onClear={clearTicketFilters}
      />

      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Client / company</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assigned</th>
              <th>Last activity</th>
            </tr>
          </thead>

          <tbody>
            {visible.map((ticket) => (
              <tr key={ticket.ticket_id}>
                <td>
                  <Link
                    className={styles.ticketIdentity}
                    href={`/tickets/${ticket.ticket_id}`}
                  >
                    <strong>{ticket.public_ref}</strong>
                    <span>{ticket.subject}</span>
                    {ticket.inbox_added_at ? (
                      <span className={styles.inboxTag}>In Inbox</span>
                    ) : null}
                  </Link>
                </td>

                <td>
                  <strong>
                    {ticket.company_name ??
                      ticket.client_name ??
                      "Contact Form guest"}
                  </strong>

                  {ticket.client_name && ticket.company_name ? (
                    <span className={styles.cellSubline}>
                      {ticket.client_name}
                    </span>
                  ) : null}
                </td>

                <td>
                  <TicketStatusBadge status={ticket.status} />
                </td>

                <td>
                  <TicketPriorityBadge priority={ticket.priority} />
                </td>

                <td>
                  {ticket.assigned_to_name ?? (
                    <span className={styles.muted}>Unassigned</span>
                  )}
                </td>

                <td>
                  {formatDateTime(
                    ticket.last_message_at ?? ticket.updated_at,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>
            {summaries.length === 0
              ? "No Tickets yet."
              : "No Tickets match your filters."}
          </strong>

          <p>
            {summaries.length === 0
              ? "New client conversations will appear here."
              : "Try a broader search or clear a filter."}
          </p>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className={styles.mobileList}>
          {visible.map((ticket) => (
            <Link
              href={`/tickets/${ticket.ticket_id}`}
              key={ticket.ticket_id}
            >
              <TicketIcon aria-hidden="true" className={styles.mobileTicketIcon} />
              <span className={styles.mobileTicketBody}>
                <header>
                  <strong>{ticket.public_ref}</strong>
                  <TicketStatusBadge status={ticket.status} />
                </header>

                <h2>{ticket.subject}</h2>

                <p>
                  {ticket.company_name ??
                    ticket.client_name ??
                    "Contact Form guest"}
                </p>

                {/*
                 * State and metadata share the footer row: the In Inbox
                 * label sits with the priority badge on the left, and the
                 * timestamp is pushed to the right edge by CSS. Keeping it
                 * here rather than between the subject and client is what
                 * makes the card scan as identity, then state.
                 */}
                <footer>
                  {ticket.inbox_added_at ? (
                    <span className={styles.inboxTag}>In Inbox</span>
                  ) : null}

                  <TicketPriorityBadge priority={ticket.priority} />

                  <span>
                    {formatDateTime(
                      ticket.last_message_at ?? ticket.updated_at,
                    )}
                  </span>
                </footer>
              </span>
            </Link>
          ))}
        </div>
      ) : null}


      <dialog
        className={`${styles.dialog} ${styles.internalCreateDialog}`}
        ref={ticketDialogRef}
        onClose={resetTicketDraft}
        onCancel={(event) => {
          if (creatingTicket) {
            event.preventDefault();
          }
        }}
      >
        <form onSubmit={submitInternalTicket}>
          <header>
            <div>
              <h2>Add ticket</h2>
              <p>
                Create a client-visible conversation from the
                Wolf Forge workspace.
              </p>
            </div>

            <button
              type="button"
              aria-label="Close"
              disabled={creatingTicket}
              onClick={() =>
                ticketDialogRef.current?.close()
              }
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className={styles.dialogBody}>

            <div
              className={styles.ticketCreateField}
              onBlur={(event) => {
                const next =
                  event.relatedTarget;

                if (
                  !(next instanceof Node) ||
                  !event.currentTarget.contains(next)
                ) {
                  setCompanyPickerOpen(false);
                }
              }}
            >
              <label htmlFor="ticket-company-search">
                Client / Company
                
              </label>

              <div className={styles.ticketCompanyPicker}>
                <div className={styles.ticketCompanySearch}>
                  <Search aria-hidden="true" />

                  <input
                    id="ticket-company-search"
                    autoComplete="off"
                    placeholder="Search client or company..."
                    value={companyQuery}
                    onFocus={() =>
                      setCompanyPickerOpen(true)
                    }
                    onChange={(event) => {
                      setCompanyQuery(
                        event.currentTarget.value,
                      );

                      setSelectedCompanyId("");
                      setCompanyPickerOpen(true);
                    }}
                  />
                </div>

                {companyPickerOpen ? (
                  <div
                    className={styles.ticketCompanyResults}
                    role="listbox"
                    aria-label="Clients and companies"
                  >
                    {companySuggestions.length > 0 ? (
                      companySuggestions.map(
                        (company) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={
                              selectedCompanyId ===
                              company.id
                            }
                            key={company.id}
                            onClick={() => {
                              setSelectedCompanyId(
                                company.id,
                              );

                              setCompanyQuery(
                                company.name,
                              );

                              setCompanyPickerOpen(
                                false,
                              );
                            }}
                          >
                            <strong>
                              {company.name}
                            </strong>

                            <span>
                              Client company
                            </span>
                          </button>
                        ),
                      )
                    ) : (
                      <p>
                        No matching clients found.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>

              <small>
                This Ticket is visible to client portal
                accounts belonging to the selected company.
              </small>
            </div>


            <label className={styles.ticketCreateField}>
              <span>
                Subject
                
              </span>

              <input
                value={ticketSubject}
                maxLength={500}
                placeholder="What is this conversation about?"
                onChange={(event) =>
                  setTicketSubject(
                    event.currentTarget.value,
                  )
                }
                required
              />
            </label>


            <div
              className={styles.ticketCreateField}
              onBlur={(event) => {
                const next = event.relatedTarget;

                if (
                  !(next instanceof Node) ||
                  !event.currentTarget.contains(next)
                ) {
                  setTicketPriorityOpen(false);
                }
              }}
            >
              <span>Priority</span>

              <div
                className={styles.ticketPriorityDropdown}
                data-open={ticketPriorityOpen}
              >
                <button
                  type="button"
                  className={styles.ticketPriorityTrigger}
                  aria-expanded={ticketPriorityOpen}
                  onClick={() =>
                    setTicketPriorityOpen((current) => !current)
                  }
                >
                  <span>
                    {ticketPriorityOptions.find(
                      ([value]) => value === ticketPriority,
                    )?.[1] ?? "Normal"}
                  </span>

                  <span
                    className={styles.ticketPriorityChevron}
                    aria-hidden="true"
                  />
                </button>

                <div
                  className={styles.ticketPriorityMenu}
                  aria-hidden={!ticketPriorityOpen}
                >
                  {ticketPriorityOptions.map(
                    ([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={styles.ticketPriorityOption}
                        data-active={ticketPriority === value}
                        onClick={() => {
                          setTicketPriority(value);
                          setTicketPriorityOpen(false);
                        }}
                      >
                        <span>{label}</span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className={styles.ticketCreateField}>
              <span>Message</span>

              <div className={styles.ticketMessageEditor}>

                <div
                  className={styles.ticketMessageToolbar}
                  aria-label="Message formatting"
                >

                  <button
                    type="button"
                    aria-label="Bold"
                    title="Bold"
                    onMouseDown={(event) =>
                      event.preventDefault()
                    }
                    onClick={() =>
                      runTicketEditorCommand(
                        "bold",
                      )
                    }
                  >
                    <Bold aria-hidden="true" />
                  </button>


                  <button
                    type="button"
                    aria-label="Italic"
                    title="Italic"
                    onMouseDown={(event) =>
                      event.preventDefault()
                    }
                    onClick={() =>
                      runTicketEditorCommand(
                        "italic",
                      )
                    }
                  >
                    <Italic aria-hidden="true" />
                  </button>


                  <div className={styles.ticketLinkControl}>
                    <button
                      type="button"
                      aria-label="Add link"
                      title="Add link"
                      data-active={ticketLinkOpen}
                      onMouseDown={(event) =>
                        event.preventDefault()
                      }
                      onClick={
                        openTicketLinkPopover
                      }
                    >
                      <Link2 aria-hidden="true" />
                    </button>


                    {ticketLinkOpen ? (
                      <div
                        className={styles.ticketLinkPopover}
                        role="dialog"
                        aria-label="Add link"
                      >
                        <label>
                          <span>Link URL</span>

                          <input
                            autoFocus
                            value={ticketLinkUrl}
                            placeholder="https://"
                            onChange={(event) =>
                              setTicketLinkUrl(
                                event.currentTarget.value,
                              )
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter"
                              ) {
                                event.preventDefault();

                                applyTicketLink();
                              }

                              if (
                                event.key === "Escape"
                              ) {
                                event.preventDefault();

                                closeTicketLinkPopover();
                              }
                            }}
                          />
                        </label>

                        <div className={styles.ticketLinkActions}>
                          <button
                            type="button"
                            onClick={
                              closeTicketLinkPopover
                            }
                          >
                            Cancel
                          </button>

                          <button
                            type="button"
                            data-primary="true"
                            onClick={
                              applyTicketLink
                            }
                          >
                            Add link
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>


                  <button
                    type="button"
                    aria-label="Heading"
                    title="Heading"
                    onMouseDown={(event) =>
                      event.preventDefault()
                    }
                    onClick={() =>
                      runTicketEditorCommand(
                        "formatBlock",
                        "h1",
                      )
                    }
                  >
                    <Heading1 aria-hidden="true" />
                  </button>


                  <span
                    className={
                      styles.ticketMessageToolbarDivider
                    }
                    aria-hidden="true"
                  />


                  <button
                    type="button"
                    aria-label="Undo"
                    title="Undo"
                    onMouseDown={(event) =>
                      event.preventDefault()
                    }
                    onClick={() =>
                      runTicketEditorCommand(
                        "undo",
                      )
                    }
                  >
                    <Undo2 aria-hidden="true" />
                  </button>


                  <button
                    type="button"
                    aria-label="Redo"
                    title="Redo"
                    onMouseDown={(event) =>
                      event.preventDefault()
                    }
                    onClick={() =>
                      runTicketEditorCommand(
                        "redo",
                      )
                    }
                  >
                    <Redo2 aria-hidden="true" />
                  </button>

                </div>


                <div
                  ref={ticketMessageRef}
                  className={styles.ticketMessageComposer}
                  role="textbox"
                  aria-label="Message"
                  aria-multiline="true"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Write the first message to the client..."
                  onInput={
                    syncTicketEditorValue
                  }
                  onBlur={
                    syncTicketEditorValue
                  }
                  onPaste={(event) =>
                    pasteTicketPlainText(
                      event,
                    )
                  }
                />

              </div>
            </div>



            {createTicketError ? (
              <p
                className={styles.ticketCreateError}
                role="alert"
              >
                {createTicketError}
              </p>
            ) : null}

          </div>

          <footer>
            <button
              className="button-secondary"
              type="button"
              disabled={creatingTicket}
              onClick={() =>
                ticketDialogRef.current?.close()
              }
            >
              Cancel
            </button>

            <button
              className="button-primary"
              type="submit"
              disabled={
                creatingTicket ||
                !selectedCompanyId ||
                !ticketSubject.trim() ||
                !ticketMessage.trim()
              }
            >
              {creatingTicket
                ? "Adding ticket..."
                : "Add ticket"}
            </button>
          </footer>
        </form>
      </dialog>
    </section>
  );
}
