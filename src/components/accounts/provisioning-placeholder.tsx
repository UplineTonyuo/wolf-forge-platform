import Link from "next/link";
import {
  Building2,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";

type ProvisioningKind =
  | "client"
  | "member"
  | "company";

const content = {
  client: {
    eyebrow: "CLIENT ACCOUNT",
    title: "Add Client",
    body:
      "Create a client portal login and connect that user to a company.",
    note:
      "The frontend route is ready. Secure account provisioning will connect here after the backend provisioning RPC is finished.",
    backHref: "/clients",
    backLabel: "Back to Clients",
  },

  member: {
    eyebrow: "WOLF FORGE TEAM",
    title: "Add Wolf Forge Member",
    body:
      "Create an internal account for a Wolf Forge team member.",
    note:
      "The frontend route is ready. Role assignment and secure auth provisioning will connect here after the backend provisioning RPC is finished.",
    backHref: "/settings",
    backLabel: "Back to Settings",
  },

  company: {
    eyebrow: "COMPANY",
    title: "Add Company",
    body:
      "Create a company record without creating a client login.",
    note:
      "The frontend route is ready. The final account-management flow will connect here after the provisioning backend is completed.",
    backHref: "/clients",
    backLabel: "Back to Clients",
  },
} satisfies Record<
  ProvisioningKind,
  {
    eyebrow: string;
    title: string;
    body: string;
    note: string;
    backHref: string;
    backLabel: string;
  }
>;

export function ProvisioningPlaceholder({
  kind,
}: {
  kind: ProvisioningKind;
}) {
  const item = content[kind];

  const Icon =
    kind === "client"
      ? UserRoundPlus
      : kind === "member"
        ? ShieldCheck
        : Building2;

  return (
    <div className="provisioning-preview">
      <div className="provisioning-preview-icon">
        <Icon aria-hidden="true" />
      </div>

      <span className="provisioning-preview-eyebrow">
        {item.eyebrow}
      </span>

      <h1>
        {item.title}
      </h1>

      <p className="provisioning-preview-body">
        {item.body}
      </p>

      <div className="provisioning-preview-note">
        <strong>
          Frontend prepared
        </strong>

        <span>
          {item.note}
        </span>
      </div>

      <div className="provisioning-preview-actions">
        <Link
          href={item.backHref}
          className="button-secondary"
        >
          {item.backLabel}
        </Link>

        <button
          type="button"
          className="button-primary"
          disabled
        >
          Backend connection pending
        </button>
      </div>
    </div>
  );
}