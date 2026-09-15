"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { assignProjectAction, changeProjectStatusAction } from "../../app/actions/orders";
import type { ProjectBulkResult } from "../../domain/orders/bulk";
import { projectInitials, projectStatusLabels, type ProjectCapabilities } from "../../domain/orders/projections";
import { orderStatuses, type OrderStatus } from "../../domain/orders/schema";
import { AnimatedSelect } from "../ui/animated-select";
import { AccountAvatar } from "../ui/account-avatar";
import { ProjectDetailActions } from "./project-detail-actions";
import type { ProjectOption } from "./projects-workspace";
import styles from "./project-detail.module.css";

const UNASSIGNED_VALUE = "";

/**
 * Status and Assignee as their own inline controls, matching the approved
 * reference's header layout, while reusing the exact same real mutations
 * ProjectDetailActions already calls. ProjectDetailActions itself stays
 * untouched (Edit/Assign/Status/Archive all remain reachable there too) —
 * this is an additional, faster path to the two most common changes, not a
 * replacement.
 */
export function OrderHeaderControls({
  orderId,
  status,
  assigneeId,
  people,
  capabilities,
}: {
  orderId: string;
  status: OrderStatus;
  assigneeId: string | null;
  people: ProjectOption[];
  capabilities: ProjectCapabilities;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function describeFailure(result: ProjectBulkResult) {
    return result.failed[0]?.error ?? "The request could not be completed.";
  }

  async function onStatusChange(nextStatus: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await changeProjectStatusAction(orderId, nextStatus);
      if (result.succeeded.length === 0) {
        setError(describeFailure(result));
        return;
      }
      router.refresh();
    } catch {
      setError("The project status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function onAssigneeChange(nextAssigneeId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await assignProjectAction(orderId, nextAssigneeId || null);
      if (result.succeeded.length === 0) {
        setError(describeFailure(result));
        return;
      }
      router.refresh();
    } catch {
      setError("The assignment could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const statusOptions = orderStatuses.map((value) => ({ value, label: projectStatusLabels[value] }));
  const assigneeOptions = [
    {
      value: UNASSIGNED_VALUE,
      label: "Unassigned",
      leading: <AccountAvatar avatarUrl={null} size={20} />,
    },
    ...people.map((person) => ({
      value: person.id,
      label: person.name,
      leading: (
        <AccountAvatar
          avatarUrl={person.avatarUrl}
          size={20}
          fallback={<span className={styles.assigneeInitials} aria-hidden="true">{projectInitials(person.name)}</span>}
        />
      ),
    })),
  ];

  return (
    <div className={styles.headerControls}>
      {capabilities.edit ? (
        <AnimatedSelect
          name="order-status"
          label="Status"
          menuLabel="Order status"
          options={statusOptions}
          value={status}
          onChange={onStatusChange}
          disabled={busy}
          compact
        />
      ) : (
        <span className={styles.headerStatValue} aria-label={`Status: ${projectStatusLabels[status]}`}>
          {projectStatusLabels[status]}
        </span>
      )}

      {capabilities.assign ? (
        <AnimatedSelect
          name="order-assignee"
          label="Assignee"
          menuLabel="Order assignee"
          options={assigneeOptions}
          value={assigneeId ?? UNASSIGNED_VALUE}
          onChange={onAssigneeChange}
          disabled={busy}
          compact
        />
      ) : (
        <span
          className={styles.headerStatValue}
          aria-label={`Assignee: ${people.find((person) => person.id === assigneeId)?.name ?? "Unassigned"}`}
        >
          {people.find((person) => person.id === assigneeId)?.name ?? "Unassigned"}
        </span>
      )}

      <ProjectDetailActions
        orderId={orderId}
        status={status}
        assigneeId={assigneeId}
        people={people}
        capabilities={capabilities}
      />

      {error ? (
        <p className={styles.headerControlsError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
