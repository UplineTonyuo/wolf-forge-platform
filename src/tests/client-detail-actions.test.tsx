/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
const updateClientDetailsAction = vi.fn();
const createInternalTicketAction = vi.fn();
const assignFormAction = vi.fn();
const sendClientWelcomeEmailAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

vi.mock("../app/actions/clients", () => ({
  updateClientDetailsAction: (...args: unknown[]) => updateClientDetailsAction(...args),
}));

vi.mock("../app/actions/tickets", () => ({
  createInternalTicketAction: (...args: unknown[]) => createInternalTicketAction(...args),
}));

vi.mock("../app/actions/forms", () => ({
  assignFormAction: (...args: unknown[]) => assignFormAction(...args),
}));

vi.mock("../app/actions/client-welcome-email", () => ({
  sendClientWelcomeEmailAction: (...args: unknown[]) => sendClientWelcomeEmailAction(...args),
}));

const { ClientDetailActions } = await import("../components/clients/client-detail-actions");

const companyId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";

const allPermissions = {
  edit: true,
  privateManage: true,
  invoiceManage: true,
  ticketCreate: true,
  formsAssign: true,
};

const primaryContact = {
  id: contactId,
  name: "Jamie Rivera",
  email: "jamie@example.com",
  phone: "555-0100",
  job_title: "Ops Lead",
};

const onboardingForms = [{ id: "form-1", name: "Client Onboarding" }];

function renderActions(overrides: Partial<Parameters<typeof ClientDetailActions>[0]> = {}) {
  return render(
    <ClientDetailActions
      companyId={companyId}
      clientName="Acme Co"
      clientStatus="client"
      primaryContact={primaryContact}
      permissions={allPermissions}
      onboardingForms={onboardingForms}
      eligibleProfiles={[]}
      welcomeEmailProfileId={null}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  refresh.mockReset();
  push.mockReset();
  updateClientDetailsAction.mockReset();
  createInternalTicketAction.mockReset();
  assignFormAction.mockReset();
  sendClientWelcomeEmailAction.mockReset();
});

afterEach(cleanup);

describe("Send welcome email", () => {
  it("appears only for a sendable portal login", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));

    expect(screen.queryByRole("menuitem", { name: /welcome email/i })).not.toBeInTheDocument();
  });

  it("sends once per confirmation and treats a later click as a new request", async () => {
    const profileId = "30000000-0000-4000-8000-000000000001";
    sendClientWelcomeEmailAction.mockResolvedValue({ ok: false, message: "The welcome email was not sent." });
    renderActions({ welcomeEmailProfileId: profileId });

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /send welcome email/i }));
    expect(screen.getByText(/no password is emailed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /send email/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/was not sent/i));

    sendClientWelcomeEmailAction.mockResolvedValue({ ok: true, message: "Welcome email sent." });
    fireEvent.click(await screen.findByRole("button", { name: /send email/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/welcome email sent/i));

    expect(sendClientWelcomeEmailAction).toHaveBeenCalledTimes(2);
    const [first, second] = sendClientWelcomeEmailAction.mock.calls;
    expect(first?.[0]).toBe(profileId);
    expect(first?.[1]).not.toBe(second?.[1]);
    expect(screen.queryByRole("button", { name: /send email/i })).not.toBeInTheDocument();
  });
});

describe("Client Detail actions menu", () => {
  it("hides the trigger entirely when no action is permitted", () => {
    const { container } = renderActions({
      permissions: {
        edit: false,
        privateManage: false,
        invoiceManage: false,
        ticketCreate: false,
        formsAssign: false,
      },
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("only shows permitted entries, and never an account-manager action", () => {
    renderActions({
      permissions: {
        edit: false,
        privateManage: false,
        invoiceManage: true,
        ticketCreate: false,
        formsAssign: false,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));

    expect(screen.getByRole("menuitem", { name: /new invoice/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /edit client/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /new ticket/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /onboarding form/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/account manager/i)).not.toBeInTheDocument();
  });

  it("points New invoice at /invoices/new with companyId preselected", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));

    const link = screen.getByRole("menuitem", { name: /new invoice/i });
    expect(link).toHaveAttribute("href", `/invoices/new?companyId=${companyId}`);
  });
});

describe("Edit client", () => {
  it("saves company and primary contact fields together", async () => {
    updateClientDetailsAction.mockResolvedValue({ ok: true });
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /edit client/i }));

    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateClientDetailsAction).toHaveBeenCalledTimes(1));

    expect(updateClientDetailsAction).toHaveBeenCalledWith(
      companyId,
      contactId,
      expect.objectContaining({
        name: "Acme Corp",
        status: "client",
        contact: expect.objectContaining({ email: "new@example.com" }),
      }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps company fields editable and skips contact fields when there is no primary contact", () => {
    renderActions({ primaryContact: null });

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /edit client/i }));

    expect(screen.getByLabelText(/business name/i)).toBeInTheDocument();
    expect(screen.getByText(/no primary contact/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
  });

  it("hides contact fields when the actor lacks client-private permission", () => {
    renderActions({ permissions: { ...allPermissions, privateManage: false } });

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /edit client/i }));

    expect(screen.getByText(/require additional permission/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
  });
});

describe("New ticket", () => {
  it("creates an explicit ticket locked to the client's company, with no order/project coupling", async () => {
    createInternalTicketAction.mockResolvedValue({ ok: true, ticketId: "ticket-1" });
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /new ticket/i }));

    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Billing question" } });
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "Client needs help." } });
    fireEvent.click(screen.getByRole("button", { name: /create ticket/i }));

    await waitFor(() => expect(createInternalTicketAction).toHaveBeenCalledTimes(1));

    const call = createInternalTicketAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.companyId).toBe(companyId);
    expect(call.subject).toBe("Billing question");
    expect(call).not.toHaveProperty("orderId");
    expect(call).not.toHaveProperty("order_id");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/tickets/ticket-1?created=1"));
  });
});

describe("Add onboarding form", () => {
  it("auto-selects the single eligible profile", async () => {
    assignFormAction.mockResolvedValue({ ok: true, data: { id: "assignment-1" } });
    renderActions({ eligibleProfiles: [{ id: "profile-1", label: "Jamie Rivera" }] });

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /onboarding form/i }));

    expect(screen.getByText(/recipient: jamie rivera/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Onboarding form"), { target: { value: "form-1" } });
    fireEvent.click(screen.getByRole("button", { name: /assign form/i }));

    await waitFor(() => expect(assignFormAction).toHaveBeenCalledTimes(1));

    expect(assignFormAction).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({
        context: expect.objectContaining({ client_profile_id: "profile-1" }),
      }),
    );
  });

  it("requires an explicit choice when multiple profiles are eligible", () => {
    renderActions({
      eligibleProfiles: [
        { id: "profile-1", label: "Jamie Rivera" },
        { id: "profile-2", label: "Sam Okafor" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /onboarding form/i }));

    expect(screen.getByLabelText(/recipient/i)).toBeInTheDocument();
    expect(screen.queryByText(/recipient: jamie rivera/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /assign form/i }));
    expect(assignFormAction).not.toHaveBeenCalled();
  });

  it("hides assignment when there is no eligible profile", () => {
    renderActions({ eligibleProfiles: [] });

    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    expect(screen.queryByRole("menuitem", { name: /onboarding form/i })).not.toBeInTheDocument();
    expect(assignFormAction).not.toHaveBeenCalled();
  });

  it("hides assignment when there is no published onboarding form", () => {
    renderActions({ onboardingForms: [], eligibleProfiles: [{ id: "profile-1", label: "Jamie" }] });
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    expect(screen.queryByRole("menuitem", { name: /onboarding form/i })).not.toBeInTheDocument();
  });

  it("hides assignment despite eligible lists when assignment permission is denied", () => {
    renderActions({ permissions: { ...allPermissions, formsAssign: false }, eligibleProfiles: [{ id: 'profile-1', label: 'Jamie' }] });
    fireEvent.click(screen.getByRole('button', { name: /actions/i }));
    expect(screen.queryByRole('menuitem', { name: /onboarding form/i })).not.toBeInTheDocument();
  });

  it("omits the Actions trigger when unusable onboarding is the only permission", () => {
    const { container } = renderActions({ permissions: { edit: false, privateManage: false, invoiceManage: false, ticketCreate: false, formsAssign: true } });
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a stale recipient rejection from the assignment server visible", async () => {
    assignFormAction.mockResolvedValue({ ok: false, error: "Recipient is no longer eligible." });
    renderActions({ eligibleProfiles: [{ id: "profile-1", label: "Jamie" }] });
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /onboarding form/i }));
    fireEvent.change(screen.getByLabelText("Onboarding form"), { target: { value: "form-1" } });
    fireEvent.click(screen.getByRole("button", { name: /assign form/i }));
    expect(await screen.findByText("Recipient is no longer eligible.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
