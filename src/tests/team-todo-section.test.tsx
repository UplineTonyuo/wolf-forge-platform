/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamTaskListRow } from "../domain/team/schema";

const push = vi.fn();
const stageKey = "ab120000-0000-4000-8000-000000000001";
vi.mock("../lib/settings/process", () => ({
  readWorkflowStages: async () => [{ key: stageKey, name: "Needs Review", description: "", color: "#335577" }],
}));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: async () => ({
  user: { teamMessaging: { use: false }, modules: { projects: true } },
  services: {
    orders: { list: async () => [
      { id: "revision", order_number: 1, title: "Revision", status: "working", process_stage: stageKey, assigned_to_profile_id: null },
      { id: "closed", order_number: 2, title: "Completed project", status: "complete", assigned_to_profile_id: null },
    ] },
    companies: { listActive: async () => [] }, catalog: { listActive: async () => [] },
  },
}) }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/todo",
}));

const listTeamTasksAction = vi.fn();
const updateTeamTaskStatusAction = vi.fn();

vi.mock("../app/actions/team-messages", () => ({
  listTeamTasksAction: (...args: unknown[]) => listTeamTasksAction(...args),
  updateTeamTaskStatusAction: (...args: unknown[]) => updateTeamTaskStatusAction(...args),
}));

const { TeamTodoSection } = await import("../components/team/team-todo-section");
const { default: ToDoPage } = await import("../app/(internal)/todo/page");

it("shows Needs Review for unassigned working orders without counting them as waiting or including completed work", async () => {
  render(await ToDoPage());
  const badge = screen.getByText("Needs Review");
  expect(badge).toHaveClass("status-working");
  expect(badge.closest("section")).toHaveTextContent("Unassigned");
  expect(screen.getByText("Nothing is waiting on a client.")).toBeInTheDocument();
  expect(screen.queryByText(/Completed project/)).not.toBeInTheDocument();
});

afterEach(() => {
  cleanup();
  push.mockClear();
  listTeamTasksAction.mockClear();
  updateTeamTaskStatusAction.mockClear();
});

function task(overrides: Partial<TeamTaskListRow> = {}): TeamTaskListRow {
  return {
    id: "task-1",
    conversation_id: "conv-1",
    source_message_id: null,
    title: "Follow up with client",
    status: "todo",
    priority: "normal",
    due_at: null,
    completed_at: null,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    assigned_to_profile_id: "actor-1",
    assigned_to_name: "Actor",
    created_by_profile_id: "actor-1",
    created_by_name: "Actor",
    other_member_name: "Colleague",
    is_mine: true,
    ...overrides,
  };
}

describe("TeamTodoSection", () => {
  it("shows no scope toggle for a non-manager — Team scope stays manager-only", () => {
    render(
      <TeamTodoSection initialTasks={[task()]} actorProfileId="actor-1" canManageTasks={false} />,
    );
    expect(screen.queryByRole("tablist", { name: "Task scope" })).not.toBeInTheDocument();
  });

  it("a manager can switch to Team scope, which refetches with includeTeam=true", async () => {
    listTeamTasksAction.mockResolvedValue({ ok: true, data: [task({ id: "task-2" })] });
    render(
      <TeamTodoSection initialTasks={[task()]} actorProfileId="actor-1" canManageTasks />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));

    expect(listTeamTasksAction).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Team tasks")).toBeInTheDocument();
  });

  it("jump-to-source navigates via the existing ?team-messages=<id> deep link, not a new mechanism", () => {
    render(
      <TeamTodoSection initialTasks={[task()]} actorProfileId="actor-1" canManageTasks={false} />,
    );

    fireEvent.click(screen.getByTitle(/conversation this task belongs to|message this task came from/i));
    expect(push).toHaveBeenCalledWith("/todo?team-messages=conv-1");
  });
});
