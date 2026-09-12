"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  bulkArchiveClientsAction,
  bulkChangeClientStatusAction,
  type ClientBulkResult,
} from "../../app/actions/clients";

export type ClientTableRow = {
  id: string;
  name: string;
  createdLabel: string;
  status: string;
  statusLabel: string;
};

export type ClientStatusOption = {
  value: string;
  label: string;
};

type BulkAction = "status" | "manager" | "delete" | "";

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

            <label>
              <span className="sr-only">Bulk action</span>
              <select
                value={action}
                disabled={busy}
                onChange={(event) => setAction(event.target.value as BulkAction)}
              >
                <option value="">Select an action</option>
                <option value="status" disabled={!canEdit}>Change status</option>
                <option value="manager">Assign a manager</option>
                <option value="delete" disabled={!canDelete}>Delete</option>
              </select>
            </label>

            {action === "status" ? (
              <label>
                <span className="sr-only">New client status</span>
                <select
                  aria-label="New client status"
                  value={status}
                  disabled={busy}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  {statuses.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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

            {action === "manager" ? (
              <span className="clients-bulk-unavailable" role="status">
                Client manager assignment is not available in the current data model.
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={selectedCount > 0 ? "clients-table-shell has-selection" : "clients-table-shell"}>
        <table className="clients-table">
          <colgroup>
            <col className="clients-table-check-column" />
            <col />
            <col className="clients-table-created-column" />
            <col className="clients-table-status-column" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  ref={selectAllRef}
                  className="clients-checkbox"
                  type="checkbox"
                  checked={allSelected}
                  aria-label={allSelected ? "Deselect all visible clients" : "Select all visible clients"}
                  onChange={toggleAll}
                />
              </th>
              <th>Client</th>
              <th>Created</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((client) => {
              const checked = selected.has(client.id);

              return (
                <tr className={checked ? "is-selected" : undefined} key={client.id}>
                  <td>
                    <input
                      className="clients-checkbox"
                      type="checkbox"
                      checked={checked}
                      aria-label={`Select ${client.name}`}
                      onChange={() => toggleOne(client.id)}
                    />
                  </td>
                  <td>
                    <Link href={`/clients/${client.id}`} className="clients-table-name">
                      {client.name}
                    </Link>
                  </td>
                  <td className="clients-table-created">{client.createdLabel}</td>
                  <td>
                    <span className={`clients-table-status is-${client.status}`}>
                      <span className={`client-status-dot is-${client.status}`} aria-hidden="true" />
                      {client.statusLabel}
                    </span>
                  </td>
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
