"use client";

import { Check, Minus, MoreHorizontal, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  bulkArchiveClientsAction,
  bulkChangeClientStatusAction,
  type ClientBulkResult,
} from "../../app/actions/clients";
import { AnimatedSelect, type AnimatedSelectOption } from "../ui/animated-select";
import { AccountAvatar } from "../ui/account-avatar";
import { useAnimatedPopover } from "../ui/use-animated-popover";

export type ClientTableRow = {
  id: string;
  name: string;
  companyName: string;
  email?: string | null;
  avatarUrl?: string | null;
  createdLabel: string;
  status: string;
  statusLabel: string;
};

export type ClientStatusOption = {
  value: string;
  label: string;
};

type BulkAction = "status" | "manager" | "delete" | "";

export function clientInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length > 1
    ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toUpperCase()
    : (words[0]?.[0] ?? "?").toUpperCase();
}

function ClientCheckbox({
  inputRef,
  checked,
  onChange,
  ariaLabel,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <span className="clients-checkbox-wrap">
      <input
        ref={inputRef}
        className="clients-checkbox"
        type="checkbox"
        checked={checked}
        aria-label={ariaLabel}
        onChange={onChange}
      />
      <Check className="clients-checkbox-icon clients-checkbox-icon-check" aria-hidden="true" />
      <Minus className="clients-checkbox-icon clients-checkbox-icon-indeterminate" aria-hidden="true" />
    </span>
  );
}

function ClientAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <AccountAvatar
      avatarUrl={src}
      size={32}
      name={name}
      className="clients-table-avatar"
      fallback={clientInitials(name)}
    />
  );
}

function ClientQuickActions({ id, name }: { id: string; name: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLAnchorElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { render, phase, animateOpen, show, showWithoutMotion, hide } = useAnimatedPopover(150);

  useEffect(() => {
    if (!render) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [hide, render]);

  function openAndFocus(animate = true) {
    if (animate) show();
    else showWithoutMotion();
    requestAnimationFrame(() => editRef.current?.focus());
  }

  return (
    <div
      className="clients-row-actions"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && render) {
          event.preventDefault();
          hide();
          triggerRef.current?.focus();
        } else if (
          ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key) &&
          !render
        ) {
          event.preventDefault();
          openAndFocus(false);
        } else if (render && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          editRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) hide();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="clients-row-action-trigger"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={render && phase === "open"}
        onClick={() => (render ? hide() : openAndFocus(true))}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {render ? (
        <div
          className={phase === "open" ? "clients-row-action-menu is-open" : "clients-row-action-menu"}
          data-open-motion={animateOpen ? "pointer" : "keyboard"}
          role="menu"
          aria-label={`Actions for ${name}`}
        >
          <Link ref={editRef} href={`/clients/${id}`} role="menuitem" onClick={hide}>
            Edit
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function describeResult(result: ClientBulkResult, action: "status" | "delete") {
  const verb = action === "delete" ? "deleted" : "updated";
  if (result.attempted === 0) return "No clients were selected.";
  if (result.succeeded.length === 0) {
    return `No clients were ${verb}. ${result.failed.length} failed.`;
  }
  if (result.failed.length === 0) {
    return result.succeeded.length === 1
      ? `1 client ${verb}.`
      : `${result.succeeded.length} clients ${verb}.`;
  }
  return `${result.succeeded.length} of ${result.attempted} clients ${verb}. ${result.failed.length} failed.`;
}

export function ClientsTable({
  rows,
  statuses,
  canEdit,
  canDelete,
}: {
  rows: ClientTableRow[];
  statuses: ClientStatusOption[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>("");
  const [status, setStatus] = useState(statuses[0]?.value ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<ClientBulkResult | null>(null);
  const [resultAction, setResultAction] = useState<"status" | "delete">("status");

  const selectedIds = useMemo(
    () => rows.filter((row) => selected.has(row.id)).map((row) => row.id),
    [rows, selected],
  );
  const selectedCount = selectedIds.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const bulkOptions: AnimatedSelectOption[] = [
    { value: "", label: "Select an action" },
    { value: "status", label: "Change status", disabled: !canEdit },
    {
      value: "manager",
      label: "Assign a manager",
      description: "Available after assignment setup",
      disabled: true,
    },
    { value: "delete", label: "Delete", disabled: !canDelete },
  ];

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  useEffect(() => {
    if (!confirmDelete) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setConfirmDelete(false);
        requestAnimationFrame(() => applyRef.current?.focus());
      }

      if (event.key === "Tab") {
        const first = cancelDeleteRef.current;
        const last = confirmDeleteRef.current;

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    cancelDeleteRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, confirmDelete]);

  function toggleOne(id: string) {
    setResult(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setResult(null);
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  async function runMutation(kind: "status" | "delete") {
    setBusy(true);

    let outcome: ClientBulkResult;
    try {
      outcome =
        kind === "status"
          ? await bulkChangeClientStatusAction(selectedIds, status)
          : await bulkArchiveClientsAction(selectedIds);
    } catch {
      outcome = {
        attempted: selectedIds.length,
        succeeded: [],
        failed: selectedIds.map((id) => ({
          id,
          label: "Unavailable client",
          error: "The request could not be completed.",
        })),
      };
    }

    setBusy(false);
    setConfirmDelete(false);
    setResultAction(kind);
    setResult(outcome);

    if (outcome.succeeded.length > 0) {
      const completed = new Set(outcome.succeeded.map((entry) => entry.id));
      setSelected((current) =>
        new Set(Array.from(current).filter((id) => !completed.has(id))),
      );
      setAction("");
      router.refresh();
    }
  }

  function requestApply() {
    if (action === "status" && status) void runMutation("status");
    if (action === "delete") setConfirmDelete(true);
  }

  return (
    <div className="clients-table-stack">
      {result ? (
        <div className="clients-bulk-result" role="status" aria-live="polite">
          <div>
            <strong>{describeResult(result, resultAction)}</strong>
            <button type="button" onClick={() => setResult(null)}>
              Dismiss
            </button>
          </div>

          {result.failed.length > 0 ? (
            <ul>
              {result.failed.map((entry) => (
                <li key={entry.id}>
                  <TriangleAlert aria-hidden="true" />
                  <span>{entry.label}</span>
                  <em>{entry.error}</em>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div
        className={selectedCount > 0 ? "clients-bulk-region is-visible" : "clients-bulk-region"}
        inert={selectedCount === 0}
      >
        <div className="clients-bulk-region-inner">
          <div className="clients-bulk-bar" aria-label="Bulk client actions">
            <strong aria-live="polite">{selectedCount} selected</strong>

            <AnimatedSelect
              name="bulk_action"
              label="Bulk action"
              menuLabel="Bulk client actions"
              options={bulkOptions}
              value={action}
              disabled={busy}
              compact
              onChange={(value) => setAction(value as BulkAction)}
            />

            {action === "status" ? (
              <AnimatedSelect
                name="client_status"
                label="New client status"
                menuLabel="Client statuses"
                options={statuses}
                value={status}
                disabled={busy}
                compact
                onChange={setStatus}
              />
            ) : null}

            <button
              ref={applyRef}
              type="button"
              className={action === "delete" ? "clients-bulk-apply is-danger" : "clients-bulk-apply"}
              disabled={busy || !action || action === "manager" || (action === "status" && !status)}
              onClick={requestApply}
            >
              {busy ? "Applying…" : "Apply"}
            </button>

          </div>
        </div>
      </div>

      <div className={selectedCount > 0 ? "clients-table-shell has-selection" : "clients-table-shell"}>
        <table className="clients-table">
          <colgroup>
            <col className="clients-table-check-column" />
            <col />
            <col className="clients-table-company-column" />
            <col className="clients-table-created-column" />
            <col className="clients-table-status-column" />
            <col className="clients-table-action-column" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <ClientCheckbox
                  inputRef={selectAllRef}
                  checked={allSelected}
                  onChange={toggleAll}
                  ariaLabel={allSelected ? "Deselect all visible clients" : "Select all visible clients"}
                />
              </th>
              <th>Client</th>
              <th className="clients-table-company-heading">Company</th>
              <th className="clients-table-created-heading">Created</th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>

          <tbody>
            {rows.map((client) => {
              const checked = selected.has(client.id);

              return (
                <tr className={checked ? "is-selected" : undefined} key={client.id}>
                  <td>
                    <ClientCheckbox
                      checked={checked}
                      onChange={() => toggleOne(client.id)}
                      ariaLabel={`Select ${client.name}`}
                    />
                  </td>
                  <td>
                    <div className="clients-table-identity">
                      <ClientAvatar name={client.name} src={client.avatarUrl} />
                      <span>
                        <Link href={`/clients/${client.id}`} className="clients-table-name">
                          {client.name}
                        </Link>
                        {client.email ? <small>{client.email}</small> : null}
                      </span>
                    </div>
                  </td>
                  <td className="clients-table-company">{client.companyName}</td>
                  <td className="clients-table-created">{client.createdLabel}</td>
                  <td>
                    <span className={`clients-table-status is-${client.status}`}>
                      <span className={`client-status-dot is-${client.status}`} aria-hidden="true" />
                      {client.statusLabel}
                    </span>
                  </td>
                  <td><ClientQuickActions id={client.id} name={client.name} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmDelete ? (
        <div
          className="clients-delete-backdrop"
          onMouseDown={() => (busy ? undefined : setConfirmDelete(false))}
        >
          <div
            className="clients-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clients-delete-title"
            aria-describedby="clients-delete-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="clients-delete-title">
              Delete {selectedCount} {selectedCount === 1 ? "client" : "clients"}?
            </h2>
            <p id="clients-delete-description">
              This cannot be undone from the app. Linked records are preserved by the existing archive path.
            </p>
            <div className="clients-delete-actions">
              <button
                ref={cancelDeleteRef}
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmDelete(false);
                  requestAnimationFrame(() => applyRef.current?.focus());
                }}
              >
                Cancel
              </button>
              <button
                ref={confirmDeleteRef}
                type="button"
                className="is-danger"
                disabled={busy}
                onClick={() => void runMutation("delete")}
              >
                {busy
                  ? "Deleting…"
                  : `Delete ${selectedCount} ${selectedCount === 1 ? "client" : "clients"}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
