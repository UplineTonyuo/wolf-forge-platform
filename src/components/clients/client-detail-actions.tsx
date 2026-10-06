"use client";

import {
  FilePlus2,
  MailPlus,
  Pencil,
  ReceiptText,
  TicketPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { assignFormAction } from "../../app/actions/forms";
import {
  updateClientDetailsAction,
} from "../../app/actions/clients";
import { createInternalTicketAction } from "../../app/actions/tickets";
import {
  sendClientWelcomeEmailAction,
  type SendClientWelcomeEmailResult,
} from "../../app/actions/client-welcome-email";
import { companyStatuses } from "../../domain/companies/schema";
import { ticketPriorityOptions } from "../../lib/tickets/presentation";

type PrimaryContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
};

type ClientDetailActionsPermissions = {
  edit: boolean;
  privateManage: boolean;
  invoiceManage: boolean;
  ticketCreate: boolean;
  formsAssign: boolean;
};

type OnboardingFormOption = { id: string; name: string };
type EligibleProfile = { id: string; label: string };

type ActiveModal = "edit" | "ticket" | "onboarding" | "welcome" | null;

const companyStatusLabels: Record<(typeof companyStatuses)[number], string> = {
  contact: "Contact",
  lead: "Lead",
  client: "Client",
  client_team: "Client Team",
};

export function ClientDetailActions({
  companyId,
  clientName,
  clientStatus,
  primaryContact,
  permissions,
  onboardingForms,
  eligibleProfiles,
  welcomeEmailProfileId,
}: {
  companyId: string;
  clientName: string;
  clientStatus: string;
  primaryContact: PrimaryContact | null;
  permissions: ClientDetailActionsPermissions;
  onboardingForms: OnboardingFormOption[];
  eligibleProfiles: EligibleProfile[];
  /** The primary contact's portal login, set only when the viewer may send it a welcome email. */
  welcomeEmailProfileId: string | null;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const hasAnyAction =
    permissions.edit ||
    permissions.invoiceManage ||
    permissions.ticketCreate ||
    permissions.formsAssign ||
    welcomeEmailProfileId !== null;

  if (!hasAnyAction) {
    return null;
  }

  const openModal = (modal: ActiveModal) => {
    setMenuOpen(false);
    setActiveModal(modal);
  };

  const closeModal = () => setActiveModal(null);

  return (
    <div ref={containerRef} className="client-actions-picker page-action-compact">
      <button
        type="button"
        className={menuOpen ? "client-actions-trigger is-open" : "client-actions-trigger"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      >
        Actions
        <span className="client-actions-chevron" aria-hidden="true" />
      </button>

      <div
        className={menuOpen ? "client-actions-menu is-open" : "client-actions-menu"}
        role="menu"
        aria-hidden={!menuOpen}
        aria-label="Client actions"
      >
        {permissions.edit ? (
          <button
            type="button"
            role="menuitem"
            tabIndex={menuOpen ? 0 : -1}
            className="client-actions-option"
            onClick={() => openModal("edit")}
          >
            <Pencil aria-hidden="true" />
            Edit client
          </button>
        ) : null}

        {permissions.invoiceManage ? (
          <Link
            role="menuitem"
            tabIndex={menuOpen ? 0 : -1}
            className="client-actions-option"
            href={`/invoices/new?companyId=${companyId}`}
            onClick={() => setMenuOpen(false)}
          >
            <ReceiptText aria-hidden="true" />
            New invoice
          </Link>
        ) : null}

        {permissions.ticketCreate ? (
          <button
            type="button"
            role="menuitem"
            tabIndex={menuOpen ? 0 : -1}
            className="client-actions-option"
            onClick={() => openModal("ticket")}
          >
            <TicketPlus aria-hidden="true" />
            New ticket
          </button>
        ) : null}

        {permissions.formsAssign ? (
          <button
            type="button"
            role="menuitem"
            tabIndex={menuOpen ? 0 : -1}
            className="client-actions-option"
            onClick={() => openModal("onboarding")}
          >
            <FilePlus2 aria-hidden="true" />
            Add onboarding form
          </button>
        ) : null}

        {welcomeEmailProfileId ? (
          <button
            type="button"
            role="menuitem"
            tabIndex={menuOpen ? 0 : -1}
            className="client-actions-option"
            onClick={() => openModal("welcome")}
          >
            <MailPlus aria-hidden="true" />
            Send welcome email
          </button>
        ) : null}
      </div>

      {activeModal === "edit" ? (
        <EditClientModal
          companyId={companyId}
          clientName={clientName}
          clientStatus={clientStatus}
          primaryContact={primaryContact}
          canManageContact={permissions.privateManage}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            router.refresh();
          }}
        />
      ) : null}

      {activeModal === "ticket" ? (
        <NewTicketModal
          companyId={companyId}
          clientName={clientName}
          onClose={closeModal}
        />
      ) : null}

      {activeModal === "onboarding" ? (
        <OnboardingFormModal
          onboardingForms={onboardingForms}
          eligibleProfiles={eligibleProfiles}
          onClose={closeModal}
          onAssigned={() => {
            closeModal();
            router.refresh();
          }}
        />
      ) : null}

      {activeModal === "welcome" && welcomeEmailProfileId ? (
        <WelcomeEmailModal
          profileId={welcomeEmailProfileId}
          contactName={primaryContact?.name ?? clientName}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}

function WelcomeEmailModal({
  profileId,
  contactName,
  onClose,
}: {
  profileId: string;
  contactName: string;
  onClose: () => void;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<SendClientWelcomeEmailResult | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    if (pending) return;

    startTransition(async () => {
      setResult(await sendClientWelcomeEmailAction(profileId, requestId));
      // Any later click is a new, deliberate request, not a retry of this one.
      setRequestId(crypto.randomUUID());
    });
  };

  return (
    <ModalShell eyebrow="CLIENT PORTAL" title="Send welcome email" onClose={onClose} pending={pending}>
      <div className="client-balance-form">
        <p>
          {contactName} gets a single-use link to set their own password. A new link replaces any
          earlier one. No password is emailed.
        </p>

        {result ? (
          <p
            className={result.ok ? "client-balance-success" : "client-balance-error"}
            role={result.ok ? "status" : "alert"}
          >
            {result.message}
          </p>
        ) : null}

        <footer className="client-balance-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            {result?.ok ? "Done" : "Cancel"}
          </button>

          {result?.ok ? null : (
            <button type="button" onClick={send} disabled={pending}>
              {pending ? "Sending..." : "Send email"}
            </button>
          )}
        </footer>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  eyebrow,
  title,
  onClose,
  pending,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  pending: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pending, onClose]);

  return createPortal(
    <div className="client-balance-modal is-open" aria-hidden={false}>
      <button
        type="button"
        className="client-balance-backdrop"
        aria-label={`Close ${title}`}
        onClick={() => {
          if (!pending) onClose();
        }}
      />

      <section className="client-balance-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="client-balance-panel-header">
          <div>
            <span>{eyebrow}</span>
            <h2>{title}</h2>
          </div>

          <button type="button" onClick={onClose} disabled={pending} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>

        {children}
      </section>
    </div>,
    document.body,
  );
}

function EditClientModal({
  companyId,
  clientName,
  clientStatus,
  primaryContact,
  canManageContact,
  onClose,
  onSaved,
}: {
  companyId: string;
  clientName: string;
  clientStatus: string;
  primaryContact: PrimaryContact | null;
  canManageContact: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(clientName);
  const [status, setStatus] = useState(clientStatus);
  const [contactName, setContactName] = useState(primaryContact?.name ?? "");
  const [contactEmail, setContactEmail] = useState(primaryContact?.email ?? "");
  const [contactPhone, setContactPhone] = useState(primaryContact?.phone ?? "");
  const [contactJobTitle, setContactJobTitle] = useState(primaryContact?.job_title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (!name.trim()) {
      setError("Enter a company name.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await updateClientDetailsAction(companyId, primaryContact?.id ?? null, {
        name: name.trim(),
        status,
        contact:
          canManageContact && primaryContact
            ? {
                name: contactName.trim() || primaryContact.name,
                email: contactEmail.trim(),
                phone: contactPhone.trim(),
                job_title: contactJobTitle.trim(),
              }
            : null,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onSaved();
    });
  };

  return (
    <ModalShell eyebrow="CLIENT" title="Edit client" onClose={onClose} pending={pending}>
      <form className="client-balance-form" onSubmit={submit}>
        <label className="client-balance-field">
          <span>Business name</span>
          <input
            type="text"
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            required
          />
        </label>

        <label className="client-balance-field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={pending}>
            {companyStatuses.map((option) => (
              <option key={option} value={option}>
                {companyStatusLabels[option]}
              </option>
            ))}
          </select>
        </label>

        {primaryContact ? (
          canManageContact ? (
            <>
              <label className="client-balance-field">
                <span>Primary contact name</span>
                <input
                  type="text"
                  maxLength={200}
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  disabled={pending}
                />
              </label>

              <label className="client-balance-field">
                <span>Email</span>
                <input
                  type="email"
                  maxLength={320}
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={pending}
                />
              </label>

              <label className="client-balance-field">
                <span>Phone</span>
                <input
                  type="tel"
                  maxLength={50}
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  disabled={pending}
                />
              </label>

              <label className="client-balance-field">
                <span>Job title</span>
                <input
                  type="text"
                  maxLength={120}
                  value={contactJobTitle}
                  onChange={(event) => setContactJobTitle(event.target.value)}
                  disabled={pending}
                />
              </label>
            </>
          ) : (
            <p className="client-balance-error" role="status">
              Contact details require additional permission to edit.
            </p>
          )
        ) : (
          <p className="client-balance-error" role="status">
            This client has no primary contact yet. Company fields can still be edited.
          </p>
        )}

        {error ? (
          <p className="client-balance-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="client-balance-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>

          <button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

function NewTicketModal({
  companyId,
  clientName,
  onClose,
}: {
  companyId: string;
  clientName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (!subject.trim() || !message.trim()) {
      setError("Complete the Subject and Message.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await createInternalTicketAction({
        requestId: crypto.randomUUID(),
        companyId,
        subject: subject.trim(),
        message: message.trim(),
        priority,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onClose();
      router.push(`/tickets/${result.ticketId}?created=1`);
    });
  };

  return (
    <ModalShell eyebrow="TICKET" title="New ticket" onClose={onClose} pending={pending}>
      <form className="client-balance-form" onSubmit={submit}>
        <p className="client-actions-modal-context">For {clientName}</p>

        <label className="client-balance-field">
          <span>Subject</span>
          <input
            type="text"
            maxLength={200}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={pending}
            required
          />
        </label>

        <label className="client-balance-field">
          <span>Message</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={pending}
            required
          />
        </label>

        <label className="client-balance-field">
          <span>Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} disabled={pending}>
            {ticketPriorityOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {error ? (
          <p className="client-balance-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="client-balance-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>

          <button type="submit" disabled={pending}>
            {pending ? "Creating..." : "Create ticket"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

function OnboardingFormModal({
  onboardingForms,
  eligibleProfiles,
  onClose,
  onAssigned,
}: {
  onboardingForms: OnboardingFormOption[];
  eligibleProfiles: EligibleProfile[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [formId, setFormId] = useState("");
  const [profileId, setProfileId] = useState(
    eligibleProfiles.length === 1 ? (eligibleProfiles[0]?.id ?? "") : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (!formId || !profileId) {
      setError("Choose a form and a recipient.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await assignFormAction(formId, {
        request_id: crypto.randomUUID(),
        context: {
          client_profile_id: profileId,
          required: true,
          due_at: null,
        },
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onAssigned();
    });
  };

  return (
    <ModalShell eyebrow="ONBOARDING" title="Add onboarding form" onClose={onClose} pending={pending}>
      <form className="client-balance-form" onSubmit={submit}>
        {onboardingForms.length === 0 ? (
          <p className="client-balance-error" role="status">
            No published onboarding Forms are available to assign.
          </p>
        ) : eligibleProfiles.length === 0 ? (
          <p className="client-balance-error" role="status">
            This company has no eligible client profile to receive an onboarding Form.
          </p>
        ) : (
          <>
            <label className="client-balance-field">
              <span>Onboarding form</span>
              <select
                value={formId}
                onChange={(event) => setFormId(event.target.value)}
                disabled={pending}
                required
              >
                <option value="" disabled>
                  Choose a form
                </option>
                {onboardingForms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name}
                  </option>
                ))}
              </select>
            </label>

            {eligibleProfiles.length > 1 ? (
              <label className="client-balance-field">
                <span>Recipient</span>
                <select
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  disabled={pending}
                  required
                >
                  <option value="" disabled>
                    Choose a recipient
                  </option>
                  {eligibleProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="client-actions-modal-context">
                Recipient: {eligibleProfiles[0]?.label}
              </p>
            )}
          </>
        )}

        {error ? (
          <p className="client-balance-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="client-balance-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>

          <button
            type="submit"
            disabled={pending || onboardingForms.length === 0 || eligibleProfiles.length === 0}
          >
            {pending ? "Assigning..." : "Assign form"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}
