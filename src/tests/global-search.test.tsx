/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as search from "../app/actions/global-search";
import { GlobalSearch } from "../components/shell/global-search";
import { notifyTicketAccessUnavailable } from "../components/tickets/ticket-access-boundary";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../app/actions/global-search", () => ({ globalSearchAction: vi.fn() }));

afterEach(cleanup);

beforeEach(() => {
  push.mockClear();
  vi.mocked(search.globalSearchAction).mockReset();
  vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [] });
});

const ticket = {
  kind: "ticket" as const,
  id: "20000000-0000-4000-8000-000000000188",
  title: "WF-TKT-000188",
  subtitle: "GMB SERVICE · QA Local Sample Client",
  href: "/tickets/20000000-0000-4000-8000-000000000188",
  predict: "WF-TKT-000188",
};

const project = {
  kind: "project" as const,
  id: "20000000-0000-4000-8000-000000000227",
  title: "Advanced 20 Page Web Build",
  subtitle: "Project #227 · Northpoint Logistics",
  href: "/orders/20000000-0000-4000-8000-000000000227",
};

/*
 * The panel debounces its action by 190ms, so a change has to be followed by
 * a wait past that before anything asserted about it is on screen.
 */
async function type(text: string) {
  const input = screen.getByLabelText("Global search");
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
  return input as HTMLInputElement;
}

/* The title is split by the match highlight, so match on the row's own text. */
function resultTitle(text: string) {
  return screen.getByText(
    (_, element) => element?.tagName === "STRONG" && element.textContent === text,
  );
}

/* The ghost text renders as `[typed text][muted remainder]`; only the
   remainder is interesting, and it is the `<em>`. */
function ghost(container: HTMLElement) {
  return container.querySelector('[class*="completion"] em')?.textContent ?? "";
}

describe("Global search: Ticket results", () => {
  it("invalidates Ticket cache on a confirmed denial before permission refresh and rejects the earlier response", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [ticket, project] });
    const view = render(<GlobalSearch />);
    await type("WF-TKT");
    let resolve!: (value: search.GlobalSearchResponse) => void;
    vi.mocked(search.globalSearchAction).mockImplementation(() => new Promise((done) => { resolve = done; }));
    await type("WF-TKT-0");
    act(() => notifyTicketAccessUnavailable(ticket.id));
    expect(view.container.textContent).not.toContain(ticket.title);
    expect(resultTitle(project.title)).toBeInTheDocument();
    await act(async () => { resolve({ ok: true, results: [ticket, project] }); });
    expect(view.container.textContent).not.toContain(ticket.title);
  });
  it("hides cached Projects alongside Tickets when the published dependency disables both", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [project, ticket] });
    const view = render(<GlobalSearch ticketsAvailable projectsAvailable />);
    await type("Adva");
    expect(resultTitle(project.title)).toBeInTheDocument();
    view.rerender(<GlobalSearch ticketsAvailable={false} projectsAvailable={false} />);
    expect(view.container.textContent).not.toContain(project.title);
    expect(view.container.textContent).not.toContain(ticket.title);
    expect(ghost(view.container)).toBe("");
  });
  it("hides cached Ticket titles, snippets and completion when access changes during a stalled search", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [ticket, project] });
    const view = render(<GlobalSearch ticketsAvailable />);
    const input = await type("WF-TKT-0001");
    expect(ghost(view.container)).toBe("88");
    vi.mocked(search.globalSearchAction).mockImplementation(() => new Promise(() => {}));
    fireEvent.change(input, { target: { value: "WF-TKT-000" } });
    view.rerender(<GlobalSearch ticketsAvailable={false} />);
    expect(view.container.textContent).not.toContain(ticket.title);
    expect(view.container.textContent).not.toContain(ticket.subtitle);
    expect(ghost(view.container)).toBe("");
    expect(resultTitle(project.title)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith(project.href));
  });
  it("renders a Ticket as its own result type and routes to the Ticket page", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [ticket] });
    render(<GlobalSearch />);

    await type("000188");

    expect(screen.getByText("TICKET")).toBeInTheDocument();
    expect(resultTitle("WF-TKT-000188")).toBeInTheDocument();
    expect(screen.getByText("GMB SERVICE · QA Local Sample Client")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option"));
    expect(push).toHaveBeenCalledWith(ticket.href);
    await waitFor(() => expect(push).toHaveBeenCalledWith(ticket.href));
    expect(ticket.href).toBe(`/tickets/${ticket.id}`);
  });

  it("keeps the existing result types rendering alongside it", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [{ ...project, kind: "client", title: "Northpoint Logistics", href: "/clients/c1", id: "c1" }, project, ticket] });
    render(<GlobalSearch />);

    await type("n");

    expect(screen.getByText("CLIENT")).toBeInTheDocument();
    expect(screen.getByText("PROJECT")).toBeInTheDocument();
    expect(screen.getByText("TICKET")).toBeInTheDocument();
  });
});

describe("Global search: inline prediction", () => {
  it("predicts the remainder of a Ticket reference and accepts it on Tab", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [ticket] });
    const { container } = render(<GlobalSearch />);

    const input = await type("WF-TKT-0001");
    await waitFor(() => expect(ghost(container)).toBe("88"));

    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("WF-TKT-000188");
  });

  it("predicts from the matched Ticket subject when the reference is not the prefix", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({
      ok: true,
      results: [{ ...ticket, predict: "Platium Service", subtitle: "Platium Service · QA Local Sample Client" }],
    });
    const { container } = render(<GlobalSearch />);

    const input = await type("Plati");
    await waitFor(() => expect(ghost(container)).toBe("um Service"));

    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("Platium Service");
  });

  it("still predicts the existing Project title case", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [project] });
    const { container } = render(<GlobalSearch />);

    await type("Adva");
    await waitFor(() => expect(ghost(container)).toBe("nced 20 Page Web Build"));
  });

  it("predicts nothing when the best result only contains the query", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [project] });
    const { container } = render(<GlobalSearch />);

    await type("20 Page");
    expect(ghost(container)).toBe("");
  });

  it("drops and re-derives the prediction as the query is edited back", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [project] });
    const { container } = render(<GlobalSearch />);

    const input = await type("Adva");
    await waitFor(() => expect(ghost(container)).toBe("nced 20 Page Web Build"));

    fireEvent.change(input, { target: { value: "Adv" } });
    await waitFor(() => expect(ghost(container)).toBe("anced 20 Page Web Build"));

    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(ghost(container)).toBe(""));
  });
});

describe("Global search: keyboard behaviour is unchanged", () => {
  it("keeps arrow navigation and Enter opening the active result", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [project, ticket] });
    render(<GlobalSearch />);

    const input = await type("WF");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith(ticket.href));
  });

  it("closes on Escape and reopens on typing", async () => {
    vi.mocked(search.globalSearchAction).mockResolvedValue({ ok: true, results: [ticket] });
    render(<GlobalSearch />);

    const input = await type("188");
    await waitFor(() => expect(screen.getByRole("option")).toBeInTheDocument());

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("option")).not.toBeInTheDocument());
  });
});
