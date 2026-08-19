import { formatDate } from "../../lib/format";
import type { FormAssignmentSummary } from "../forms/schema";
import { onboardingAttention, type AttentionState } from "./attention";

/**
 * The client Onboarding read model.
 *
 * There is no separate onboarding table and this module does not invent one.
 * Onboarding is exactly the set of Forms already assigned to the account by
 * app_list_assigned_forms — an RPC that derives the caller from auth.uid() and
 * scopes to their own company. Nothing here adds a requirement Wolf Forge has
 * not actually assigned.
 *
 * Two assigned form types reach a client, and they mean different things:
 *   onboarding  account-level setup Wolf Forge needs before or during work
 *   intake      information tied to one specific project
 *
 * They are presented as two groups rather than one flat list, because "set up
 * your account" and "answer questions about project WF-P0007" are not the same
 * request.
 */

export type OnboardingItem = {
  assignmentId: string;
  title: string;
  /** One short line of real context: the project it belongs to, or its purpose. */
  context: string;
  attention: AttentionState;
  required: boolean;
  dueLabel: string | null;
  completedLabel: string | null;
  /** Start / Continue / View — chosen from the item's real state. */
  action: "Start" | "Continue" | "View";
  href: string;
};

export type OnboardingGroup = {
  id: "account" | "project";
  label: string;
  description: string;
  items: OnboardingItem[];
};

export type OnboardingProgress = {
  completed: number;
  total: number;
};

export type ClientOnboarding = {
  groups: OnboardingGroup[];
  outstanding: OnboardingItem[];
  /**
   * Real completion, or null when there is nothing to measure. Never a
   * percentage: "3 of 5" is a fact, a percent bar over five items is decoration.
   */
  progress: OnboardingProgress | null;
};

/** Assignments the client no longer has to do anything about. */
function isRetired(status: FormAssignmentSummary["status"]): boolean {
  return status === "archived" || status === "canceled";
}

function toItem(assignment: FormAssignmentSummary): OnboardingItem {
  const hasDraft = assignment.status === "assigned" && assignment.latest_submission_id !== null;
  const attention = onboardingAttention(assignment.status, hasDraft);

  const context = assignment.order_title
    ? assignment.order_title
    : assignment.form_type === "onboarding"
      ? "Account setup"
      : "Project intake";

  return {
    assignmentId: assignment.assignment_id,
    title: assignment.title,
    context,
    attention,
    required: assignment.required,
    dueLabel: assignment.due_at ? formatDate(assignment.due_at) : null,
    completedLabel: assignment.completed_at ? formatDate(assignment.completed_at) : null,
    action: assignment.status === "completed" ? "View" : hasDraft ? "Continue" : "Start",
    href: `/account/onboarding/${assignment.assignment_id}`,
  };
}

export function composeClientOnboarding(
  assignments: FormAssignmentSummary[],
): ClientOnboarding {
  const live = assignments.filter((assignment) => !isRetired(assignment.status));
  const items = live.map(toItem);

  const account = items.filter((_, index) => live[index]!.form_type === "onboarding");
  const project = items.filter((_, index) => live[index]!.form_type === "intake");

  const groups: OnboardingGroup[] = [];

  if (account.length > 0) {
    groups.push({
      id: "account",
      label: "Account setup",
      description: "What Wolf Forge needs to get your account fully operational.",
      items: account,
    });
  }

  if (project.length > 0) {
    groups.push({
      id: "project",
      label: "Project information",
      description: "Details tied to specific work already underway.",
      items: project,
    });
  }

  const completed = items.filter((item) => item.attention.tone === "completed").length;

  return {
    groups,
    outstanding: items.filter((item) => item.attention.tone === "waiting_on_you"),
    progress: items.length === 0 ? null : { completed, total: items.length },
  };
}
