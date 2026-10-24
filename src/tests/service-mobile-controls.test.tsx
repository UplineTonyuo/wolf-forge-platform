/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceForm } from "../components/services/service-form";
import { FolderForm } from "../components/services/folder-form";
import type { ServiceFolderRow } from "../lib/supabase/database-rows";

vi.mock("../app/actions/services", () => ({ createServiceAction: vi.fn(), updateServiceAction: vi.fn(), createServiceFolderAction: vi.fn(), updateServiceFolderAction: vi.fn() }));
afterEach(cleanup);
const folders = [{ id: "folder-a", name: "SEO", parent_id: null }, { id: "folder-b", name: "Web", parent_id: null }] as ServiceFolderRow[];

function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

it("carries custom service selections through the unchanged submitted field names", () => {
  const { container } = render(<ServiceForm mode="create" folders={folders} assignees={[{ id: "staff", displayName: "Studio staff" }]} />);
  choose("Folder", "SEO"); choose("Currency", "EUR");
  fireEvent.click(screen.getByRole("checkbox", { name: /Recurring service/ }));
  choose("Interval unit", "Week"); choose("Recurring action", "Create new Project");
  choose("Assigned teammate", "Studio staff"); choose("Deadline unit", "Hour(s)");
  const data = new FormData(container.querySelector("form")!);
  expect(Object.fromEntries(["folder_id", "currency", "recurring_interval_unit", "recurring_action", "assigned_to_profile_id", "deadline_unit"].map((name) => [name, data.get(name)])))
    .toEqual({ folder_id: "folder-a", currency: "EUR", recurring_interval_unit: "W", recurring_action: "create_order", assigned_to_profile_id: "staff", deadline_unit: "H" });
  expect(screen.getByRole("link", { name: "Manage intake forms" })).toHaveAttribute("href", "/forms");
  expect(screen.queryByText("Forms domain is not implemented")).not.toBeInTheDocument();
});

it("keeps a folder-locked service value exactly once in the submitted payload", () => {
  const { container } = render(<ServiceForm mode="create" folders={folders} assignees={[]} preselectedFolderId="folder-b" />);
  expect(screen.getByRole("button", { name: "Folder: Web" })).toBeDisabled();
  expect(new FormData(container.querySelector("form")!).getAll("folder_id")).toEqual(["folder-b"]);
});

it("keeps the existing folder parent contract and excludes choosing itself", () => {
  const { container } = render(<FolderForm folder={folders[0]} folders={folders} />);
  fireEvent.click(screen.getByRole("button", { name: "Parent folder: Root" }));
  expect(screen.queryByRole("option", { name: "SEO" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "Web" }));
  expect(new FormData(container.querySelector("form")!).get("parent_id")).toBe("folder-b");
});
