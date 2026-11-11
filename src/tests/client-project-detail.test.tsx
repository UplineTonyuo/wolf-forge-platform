/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClientProjectDetail } from "../components/account/projects/client-projects";
import type { ClientProjectView } from "../domain/orders/client-projections";
import Link from "next/link";
vi.mock("../components/tickets/project-conversation", () => ({ ProjectConversation: () => <div>Chat controls and composer</div> }));
const project: ClientProjectView = { id: "order", reference: "WF-P0013", title: "Client order", status: "working", statusLabel: "In progress", serviceName: "Search", createdLabel: "10 Nov", startedLabel: "11 Nov", dueLabel: null, completedLabel: null, progress: { total: 3, completed: 1, percent: 33 } };
afterEach(cleanup);
it("removes an already mounted conversation when the authoritative state becomes locked", () => {
  const props = { project, conversation: null, viewerId: "client", startControl: <Link href="/account/onboarding/required">Continue form</Link> };
  const view = render(<ClientProjectDetail {...props} chatAccess="unlocked" />);
  expect(screen.getByText("Chat controls and composer")).toBeInTheDocument();
  view.rerender(<ClientProjectDetail {...props} chatAccess="locked" />);
  expect(screen.queryByText("Chat controls and composer")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue form" })).toBeInTheDocument();
  expect(screen.getByText("1 of 3 delivery steps complete.")).toBeInTheDocument();
  for (const label of ["Reference", "Service", "Opened", "Started", "Due", "Completed"]) expect(screen.getByText(label)).toBeInTheDocument();
});
it("fails closed for an unavailable state while preserving safe Project facts", () => {
  render(<ClientProjectDetail project={project} conversation={null} viewerId="client" chatAccess="unavailable" />);
  expect(screen.queryByText("Chat controls and composer")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/could not be confirmed/);
  expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
});
