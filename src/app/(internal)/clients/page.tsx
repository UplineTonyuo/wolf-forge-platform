import { ClientsHeaderTools } from "../../../components/clients/clients-header-tools";
import type { Metadata } from "next";
import Link from "next/link";
import { ClientsActionMenu } from "../../../components/clients/clients-action-menu";
import { EmptyState } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { formatDate } from "../../../lib/format";
import {
  clientNameSearchScore,
  compareClientSearchMatches,
} from "../../../lib/client-name-search";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = {
  title: "Clients",
};

const lifecycleStatuses = [
  "contact",
  "lead",
  "client",
  "client_team",
] as const;

type LifecycleStatus =
  (typeof lifecycleStatuses)[number];

type ClientFilter =
  | LifecycleStatus
  | "all";

const filterOptions: Array<{
  value: ClientFilter;
  label: string;
}> = [
  {
    value: "contact",
    label: "Contact",
  },
  {
    value: "lead",
    label: "Lead",
  },
  {
    value: "client",
    label: "Client",
  },
  {
    value: "client_team",
    label: "Client Team",
  },
  {
    value: "all",
    label: "All",
  },
];

function normalizeStatus(
  status: string,
): LifecycleStatus {
  if (
    lifecycleStatuses.includes(
      status as LifecycleStatus,
    )
  ) {
    return status as LifecycleStatus;
  }

  return "contact";
}

function statusLabel(
  status: string,
) {
  switch (normalizeStatus(status)) {
    case "lead":
      return "Lead";

    case "client":
      return "Client";

    case "client_team":
      return "Client Team";

    default:
      return "Contact";
  }
}

function filterHref(
  status: ClientFilter,
  q: string,
) {
  const params =
    new URLSearchParams();

  if (q.trim()) {
    params.set("q", q.trim());
  }

  if (status !== "all") {
    params.set("status", status);
  }

  const query =
    params.toString();

  return query
    ? `/clients?${query}`
    : "/clients";
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
  }>;
}) {
  const {
    q = "",
    status = "all",
  } = await searchParams;

  const selectedStatus: ClientFilter =
    status === "all" ||
    lifecycleStatuses.includes(
      status as LifecycleStatus,
    )
      ? (status as ClientFilter)
      : "all";

  const context =
    await getInternalContext();

  try {
    const clients =
      await context.services.companies.listActive();

    const search =
      q.trim();

    const filtered =
      clients.filter((client) => {
        const matchesSearch =
          !search ||
          clientNameSearchScore(
            client.name,
            search,
          ) !== null;

        const matchesStatus =
          selectedStatus === "all" ||
          normalizeStatus(
            client.status,
          ) === selectedStatus;

        return (
          matchesSearch &&
          matchesStatus
        );
      });

    if (search) {
      filtered.sort(
        (left, right) =>
          compareClientSearchMatches(
            left.name,
            right.name,
            search,
          ),
      );
    }

    const countFor = (
      target: ClientFilter,
    ) => {
      if (target === "all") {
        return clients.length;
      }

      return clients.filter(
        (client) =>
          normalizeStatus(
            client.status,
          ) === target,
      ).length;
    };

    return (
      <PageFrame title="Clients">
        <div className="clients-status-row">
          <nav
            className="clients-status-tabs"
            aria-label="Client status filters"
          >
            {filterOptions.map(
              (option) => {
                const active =
                  selectedStatus ===
                  option.value;

                return (
                  <Link
                    key={option.value}
                    href={filterHref(
                      option.value,
                      q,
                    )}
                    className={
                      active
                        ? "clients-status-tab is-active"
                        : "clients-status-tab"
                    }
                    aria-current={
                      active
                        ? "page"
                        : undefined
                    }
                  >
                    <span>
                      {option.label}
                    </span>

                    <span className="clients-status-count">
                      {countFor(
                        option.value,
                      )}
                    </span>
                  </Link>
                );
              },
            )}
          </nav>

          <div className="clients-status-action">
            <ClientsActionMenu
              displayName={
                context.user.displayName
              }
            />
          </div>
        </div>

        <div className="clients-list-toolbar">
          <ClientsHeaderTools
            initialQuery={q}
          />
        </div>

        {clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            body="Create your first account to begin managing client relationships."
            action={
              <ClientsActionMenu
                displayName={
                  context.user.displayName
                }
              />
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No matching clients"
            body={
              q
                ? `No clients match "${q}" in this status.`
                : "There are no clients in this status yet."
            }
          />
        ) : (
          <div className="clients-table-shell">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Created</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map(
                  (client) => (
                    <tr key={client.id}>
                      <td>
                        <Link
                          href={`/clients/${client.id}`}
                          className="clients-table-name"
                        >
                          {client.name}
                        </Link>
                      </td>

                      <td className="clients-table-created">
                        {formatDate(
                          client.created_at,
                        )}
                      </td>

                      <td>
                        <span
                          className={`clients-table-status is-${normalizeStatus(
                            client.status,
                          )}`}
                        >
                          <span
                            className={`client-status-dot is-${normalizeStatus(
                              client.status,
                            )}`}
                            aria-hidden="true"
                          />

                          {statusLabel(
                            client.status,
                          )}
                        </span>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </PageFrame>
    );
  } catch (error) {
    const safe =
      toClientSafeError(error);

    return (
      <PageFrame title="Clients">
        <div
          className="clients-load-error"
          role="alert"
        >
          <strong>
            Clients could not be loaded.
          </strong>

          <span>
            {safe.message}
          </span>
        </div>
      </PageFrame>
    );
  }
}