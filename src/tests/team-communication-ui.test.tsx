/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamAvatar } from "../components/team/team-avatar";
import { TeamTaskCard } from "../components/team/team-task-card";
import { TeamTasksPanel } from "../components/team/team-tasks-panel";
import { DatePicker } from "../components/ui/date-picker";
import { toTeamTaskListViews, toTeamTaskView } from "../domain/team/projections";
import type { TeamTaskRow } from "../domain/team/schema";

afterEach(cleanup);

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

function TaskDateHarness() {
  const [value, setValue] = useState("");
  return (
    <DatePicker
      name="due_date"
      label="Due date"
      value={value}
      onChange={setValue}
      placeholder="No due date"
      today="2026-08-26"
      menuLabel="Choose task due date"
      placement="above"
      shortcuts
      clearable
    />
  );
}

function task(overrides: Partial<TeamTaskRow> & { id: string }): TeamTaskRow {
  return {
    conversation_id: "33333333-3333-4333-8333-333333333333",
    source_message_id: null,
    title: "Fix the subscription mobile layout",
    description: null,
    status: "todo",
    priority: "normal",
    due_at: null,
    completed_at: null,
    created_at: "2026-08-26T09:00:00.000Z",
    updated_at: "2026-08-26T09:00:00.000Z",
    assigned_to_profile_id: ME,
    assigned_to_name: "William Jones",
    created_by_profile_id: THEM,
    created_by_name: "Anthony Paghubasan",
    ...overrides,
  };
}

/**
 * Team Messages UI.
 *
 * Focused on the two things the browser is genuinely responsible for: showing
 * the whole workflow rather than only the next step, and disabling — never
 * hiding — a control the database would refuse. Nothing here is a security
 * boundary; the boundary is in 044_team_communication_tasks.test.sql.
 */
describe("Team task card", () => {
  it("offers the whole workflow, with the current status marked and unclickable", () => {
    render(
      <TeamTaskCard
        task={toTeamTaskView(task({ id: "1", status: "in_progress" }), ME)}
        actorProfileId={ME}
        canManageTasks={false}
        onStatusChange={vi.fn()}
      />,
    );

    for (const label of ["To Do", "In Progress", "Done"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    const current = screen.getByRole("button", { name: "In Progress" });
    expect(current).toHaveAttribute("aria-pressed", "true");
    expect(current).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("lets the assignee move a card without task management rights", () => {
    const onStatusChange = vi.fn();
    render(
      <TeamTaskCard
        task={toTeamTaskView(task({ id: "1", assigned_to_profile_id: ME }), ME)}
        actorProfileId={ME}
        canManageTasks={false}
        onStatusChange={onStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "In Progress" }));
    expect(onStatusChange).toHaveBeenCalledWith("in_progress");
  });

  it("marks only the clicked status button busy while the card is saving, not every disabled button", () => {
    const { rerender } = render(
      <TeamTaskCard
        task={toTeamTaskView(task({ id: "1", assigned_to_profile_id: ME }), ME)}
        actorProfileId={ME}
        canManageTasks={false}
        onStatusChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "In Progress" }));

    rerender(
      <TeamTaskCard
        task={toTeamTaskView(task({ id: "1", assigned_to_profile_id: ME }), ME)}
        actorProfileId={ME}
        canManageTasks={false}
        onStatusChange={vi.fn()}
        busy
      />,
    );

    expect(screen.getByRole("button", { name: "In Progress" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Done" })).not.toHaveAttribute("aria-busy");
  });

  it("disables rather than hides the controls when the viewer may not move it", () => {
    render(
      <TeamTaskCard
        task={toTeamTaskView(
          task({ id: "1", assigned_to_profile_id: THEM, created_by_profile_id: THEM }),
          ME,
        )}
        actorProfileId={ME}
        canManageTasks={false}
        onStatusChange={vi.fn()}
      />,
    );

    /* The card still shows its full state; it simply cannot be moved. */
    expect(screen.getByRole("button", { name: "In Progress" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    expect(screen.getByText("William Jones")).toBeInTheDocument();
  });

  it("shows priority, assignee and an overdue due date", () => {
    render(
      <TeamTaskCard
        task={toTeamTaskView(
          task({ id: "1", priority: "urgent", due_at: "2020-01-01T00:00:00.000Z" }),
          ME,
        )}
        actorProfileId={ME}
        canManageTasks
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it("offers source-message navigation only when a task actually came from one", () => {
    const onNavigateToSource = vi.fn();

    const { rerender } = render(
      <TeamTaskCard
        task={toTeamTaskView(task({ id: "1", source_message_id: null }), ME)}
        actorProfileId={ME}
        canManageTasks
        onStatusChange={vi.fn()}
        onNavigateToSource={onNavigateToSource}
      />,
    );
    expect(screen.queryByRole("button", { name: /From message/ })).not.toBeInTheDocument();

    rerender(
      <TeamTaskCard
        task={toTeamTaskView(task({ id: "1", source_message_id: "m1" }), ME)}
        actorProfileId={ME}
        canManageTasks
        onStatusChange={vi.fn()}
        onNavigateToSource={onNavigateToSource}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /From message/ }));
    expect(onNavigateToSource).toHaveBeenCalledWith("m1");
  });

  it("carries no client vocabulary: no Team Note, ticket status or client status", () => {
    render(
      <TeamTaskCard
        task={toTeamTaskView(task({ id: "1" }), ME)}
        actorProfileId={ME}
        canManageTasks
        onStatusChange={vi.fn()}
      />,
    );

    const card = screen.getByRole("article");
    for (const clientWord of [
      /team note/i,
      /internal note/i,
      /awaiting client/i,
      /client status/i,
      /ticket/i,
      /resolved/i,
    ]) {
      expect(within(card).queryByText(clientWord)).not.toBeInTheDocument();
    }
  });
});

describe("Team presence and task scheduling primitives", () => {
  it("announces restrained avatar presence as online or offline", () => {
    const { rerender } = render(
      <TeamAvatar
        name="Anthony Paghubasan"
        initials="AP"
        avatarUrl={null}
        presence="online"
      />,
    );
    expect(screen.getByText("Anthony Paghubasan is online")).toBeInTheDocument();

    rerender(
      <TeamAvatar
        name="Anthony Paghubasan"
        initials="AP"
        avatarUrl={null}
        presence="offline"
      />,
    );
    expect(screen.getByText("Anthony Paghubasan is offline")).toBeInTheDocument();
  });

  it("offers quick task dates and an explicit clear path without a native date input", () => {
    const { container } = render(<TaskDateHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Due date: No due date" }));

    expect(screen.getByRole("dialog", { name: "Choose task due date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tomorrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(container.querySelector('input[name="due_date"]')).toHaveValue("2026-08-27");
    expect(container.querySelector('input[type="date"]')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Due date: Aug 27, 2026/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(container.querySelector('input[name="due_date"]')).toHaveValue("");
  });
});

describe("Tasks panel", () => {
  const tasks = toTeamTaskListViews(
    [
      { ...task({ id: "1", status: "todo" }), other_member_name: "Anthony Paghubasan", is_mine: true },
      { ...task({ id: "2", status: "done", completed_at: "2026-08-26T10:00:00.000Z" }), other_member_name: "Anthony Paghubasan", is_mine: true },
    ],
    ME,
  );

  function panel(overrides: Partial<Parameters<typeof TeamTasksPanel>[0]> = {}) {
    return (
      <TeamTasksPanel
        tasks={tasks}
        scope="mine"
        onScopeChange={vi.fn()}
        canManageTasks={false}
        actorProfileId={ME}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onBack={vi.fn()}
        onOpenConversation={vi.fn()}
        onTaskStatusChange={vi.fn()}
        busyTaskId={null}
        {...overrides}
      />
    );
  }

  it("groups tasks under their status headings", () => {
    render(panel());
    /*
     * Scoped to the heading element: "To Do" is also a status control on every
     * card, and an unscoped query cannot tell a column apart from a button.
     */
    expect(screen.getByText("To Do", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Done", { selector: "strong" })).toBeInTheDocument();
    /* In Progress has no tasks, so its column is absent rather than empty. */
    expect(screen.queryByText("In Progress", { selector: "strong" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("offers Team Tasks only to a task manager", () => {
    const { rerender } = render(panel({ canManageTasks: false }));
    expect(screen.queryByRole("tab", { name: /Team/ })).not.toBeInTheDocument();

    rerender(panel({ canManageTasks: true }));
    expect(screen.getByRole("tab", { name: /Team/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Mine/ })).toHaveAttribute("aria-selected", "true");
  });

  it("switches scope through the segmented control", () => {
    const onScopeChange = vi.fn();
    render(panel({ canManageTasks: true, onScopeChange }));
    fireEvent.click(screen.getByRole("tab", { name: /Team/ }));
    expect(onScopeChange).toHaveBeenCalledWith("team");
  });

  it("shows an empty state that matches the viewer's rights", () => {
    const { rerender } = render(panel({ tasks: [], canManageTasks: false }));
    expect(screen.getByText("Nothing assigned to you")).toBeInTheDocument();
    expect(screen.getByText(/assigned to you by management/i)).toBeInTheDocument();

    rerender(panel({ tasks: [], canManageTasks: true, scope: "team" }));
    expect(screen.getByText("No team tasks yet")).toBeInTheDocument();
    expect(screen.getByText(/Create one from a message/i)).toBeInTheDocument();
  });

  it("shows a recoverable error state rather than an empty list", () => {
    const onRetry = vi.fn();
    render(panel({ tasks: [], error: "Something went wrong.", onRetry }));

    expect(screen.getByText("Tasks could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("Nothing assigned to you")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows a busy placeholder on the first load and no empty state yet", () => {
    render(panel({ tasks: [], loading: true }));
    expect(screen.getByRole("region", { name: "Team tasks" }).querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText("Nothing assigned to you")).not.toBeInTheDocument();
  });

  it("lets a card without a source message still reach its conversation", () => {
    const onOpenConversation = vi.fn();
    render(panel({ onOpenConversation }));

    fireEvent.click(screen.getAllByRole("button", { name: /Open thread/ })[0]!);
    expect(onOpenConversation).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", null);
  });
});
