"use client";

import {
  Check,
  ChevronRight,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./team-roles-panel.module.css";

type View = "team" | "roles";

type RoleName =
  | "Owner"
  | "Admin"
  | "Manager"
  | "Staff"
  | "Client";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: RoleName;
};

type PermissionItem = {
  key: string;
  label: string;
};

type PermissionGroup = {
  title: string;
  description: string;
  items: PermissionItem[];
};

const ROLE_ORDER: RoleName[] = [
  "Owner",
  "Admin",
  "Manager",
  "Staff",
  "Client",
];

const TEAM_MEMBERS: TeamMember[] = [
  {
    id: "william",
    name: "William Jones",
    email: "hcjaxx123@gmail.com",
    role: "Owner",
  },
  {
    id: "operations",
    name: "Operations Manager",
    email: "buce.oexepower@gmail.com",
    role: "Manager",
  },
  {
    id: "isaiah",
    name: "Isaiah",
    email: "isaiah@wolfforgemarketing.com",
    role: "Manager",
  },
  {
    id: "john",
    name: "John",
    email: "john@wolfforgemarketing.com",
    role: "Manager",
  },
  {
    id: "lorenzo",
    name: "Lorenzo",
    email: "lorenzo@wolfforgemarketing.com",
    role: "Manager",
  },
  {
    id: "nardo",
    name: "Nardo",
    email: "nardo@wolfforgemarketing.com",
    role: "Manager",
  },
  {
    id: "vincent",
    name: "Vincent Jay Gonzaga",
    email: "vincent@wolfforgemarketing.com",
    role: "Manager",
  },
  {
    id: "anthony",
    name: "Anthony Paghubasan",
    email: "paghubasanantonio7@gmail.com",
    role: "Manager",
  },
];

const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  Owner:
    "Full authority across Wolf Forge, including security and permission management.",
  Admin:
    "Broad administrative access across workspace operations.",
  Manager:
    "Operational control across projects, tickets, clients, and team work.",
  Staff:
    "Focused access for assigned operational responsibilities.",
  Client:
    "Client-facing access limited to permitted features and company-scoped data.",
};

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: "Dashboard",
    description: "Workspace overview.",
    items: [
      {
        key: "dashboard.view",
        label: "View dashboard",
      },
    ],
  },
  {
    title: "Projects",
    description: "Delivery and project operations.",
    items: [
      {
        key: "projects.view",
        label: "View projects",
      },
      {
        key: "projects.create",
        label: "Create projects",
      },
      {
        key: "projects.edit",
        label: "Edit projects",
      },
      {
        key: "projects.assign",
        label: "Assign projects",
      },
      {
        key: "projects.archive",
        label: "Archive projects",
      },
    ],
  },
  {
    title: "Tickets",
    description: "Support and ticket operations.",
    items: [
      {
        key: "tickets.view",
        label: "View tickets",
      },
      {
        key: "tickets.create",
        label: "Create tickets",
      },
      {
        key: "tickets.edit",
        label: "Edit tickets",
      },
      {
        key: "tickets.assign",
        label: "Assign tickets",
      },
      {
        key: "tickets.archive",
        label: "Archive tickets",
      },
    ],
  },
  {
    title: "Clients",
    description: "Client directory controls.",
    items: [
      {
        key: "clients.view",
        label: "View clients",
      },
      {
        key: "clients.create",
        label: "Create clients",
      },
      {
        key: "clients.edit",
        label: "Edit clients",
      },
      {
        key: "clients.archive",
        label: "Archive clients",
      },
    ],
  },
  {
    title: "To Do",
    description: "Operational tasks.",
    items: [
      {
        key: "todo.view",
        label: "View tasks",
      },
      {
        key: "todo.manage",
        label: "Manage tasks",
      },
    ],
  },
  {
    title: "Billing",
    description: "Invoices and subscriptions.",
    items: [
      {
        key: "invoices.view",
        label: "View invoices",
      },
      {
        key: "invoices.manage",
        label: "Manage invoices",
      },
      {
        key: "subscriptions.view",
        label: "View subscriptions",
      },
      {
        key: "subscriptions.manage",
        label: "Manage subscriptions",
      },
    ],
  },
  {
    title: "Marketing",
    description: "Promotional controls.",
    items: [
      {
        key: "coupons.view",
        label: "View coupons",
      },
      {
        key: "coupons.manage",
        label: "Manage coupons",
      },
    ],
  },
  {
    title: "Services",
    description: "Service catalog.",
    items: [
      {
        key: "services.view",
        label: "View services",
      },
      {
        key: "services.create",
        label: "Create services",
      },
      {
        key: "services.edit",
        label: "Edit services",
      },
      {
        key: "services.archive",
        label: "Archive services",
      },
    ],
  },
  {
    title: "Forms",
    description: "Workspace forms.",
    items: [
      {
        key: "forms.view",
        label: "View forms",
      },
      {
        key: "forms.manage",
        label: "Manage forms",
      },
    ],
  },
  {
    title: "Team & Settings",
    description: "Sensitive administration.",
    items: [
      {
        key: "settings.view",
        label: "View settings",
      },
      {
        key: "users.view",
        label: "View team",
      },
      {
        key: "users.create",
        label: "Create users",
      },
      {
        key: "users.edit",
        label: "Edit users",
      },
      {
        key: "users.manage_permissions",
        label: "Manage permissions",
      },
    ],
  },
];

const ALL_PERMISSION_KEYS =
  PERMISSION_GROUPS.flatMap(
    (group) =>
      group.items.map(
        (item) => item.key,
      ),
  );

const INITIAL_PERMISSIONS:
  Record<RoleName, string[]> = {
  Owner: [...ALL_PERMISSION_KEYS],

  Admin: [...ALL_PERMISSION_KEYS],

  Manager: [
    "dashboard.view",

    "projects.view",
    "projects.create",
    "projects.edit",
    "projects.assign",

    "tickets.view",
    "tickets.create",
    "tickets.edit",
    "tickets.assign",

    "clients.view",

    "todo.view",
    "todo.manage",

    "invoices.view",
    "subscriptions.view",

    "services.view",
    "forms.view",
  ],

  Staff: [
    "dashboard.view",

    "projects.view",

    "tickets.view",
    "tickets.create",
    "tickets.edit",

    "todo.view",

    "services.view",
    "forms.view",
  ],

  Client: [
    "dashboard.view",
    "projects.view",
    "tickets.view",
    "tickets.create",
    "invoices.view",
    "subscriptions.view",
  ],
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(
      (part) =>
        part[0]?.toUpperCase() ?? "",
    )
    .join("");
}

function roleClass(role: RoleName) {
  if (role === "Owner") {
    return styles.roleOwner;
  }

  if (role === "Admin") {
    return styles.roleAdmin;
  }

  if (role === "Manager") {
    return styles.roleManager;
  }

  if (role === "Staff") {
    return styles.roleStaff;
  }

  return styles.roleClient;
}

export function TeamRolesPanel() {
  const [view, setView] =
    useState<View>("team");

  const [
    selectedRole,
    setSelectedRole,
  ] =
    useState<RoleName>("Manager");

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    permissions,
    setPermissions,
  ] = useState<
    Record<RoleName, string[]>
  >(INITIAL_PERMISSIONS);

  const [
    notice,
    setNotice,
  ] =
    useState<string | null>(null);

  const selectedPermissions =
    useMemo(
      () =>
        new Set(
          permissions[selectedRole],
        ),
      [permissions, selectedRole],
    );

  const filteredTeam =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      if (!query) {
        return TEAM_MEMBERS;
      }

      return TEAM_MEMBERS.filter(
        (member) =>
          member.name
            .toLowerCase()
            .includes(query) ||
          member.email
            .toLowerCase()
            .includes(query) ||
          member.role
            .toLowerCase()
            .includes(query),
      );
    }, [search]);

  const roleCounts =
    useMemo(() => {
      const counts =
        Object.fromEntries(
          ROLE_ORDER.map(
            (role) => [role, 0],
          ),
        ) as Record<
          RoleName,
          number
        >;

      TEAM_MEMBERS.forEach(
        (member) => {
          counts[member.role] += 1;
        },
      );

      return counts;
    }, []);

  function openRole(
    role: RoleName,
  ) {
    setSelectedRole(role);
    setView("roles");
    setNotice(null);
  }

  function togglePermission(
    permissionKey: string,
  ) {
    if (selectedRole === "Owner") {
      setNotice(
        "Owner keeps full access.",
      );
      return;
    }

    setPermissions(
      (current) => {
        const active = new Set(
          current[selectedRole],
        );

        if (
          active.has(permissionKey)
        ) {
          active.delete(
            permissionKey,
          );
        } else {
          active.add(
            permissionKey,
          );
        }

        return {
          ...current,
          [selectedRole]:
            Array.from(active),
        };
      },
    );

    setNotice(null);
  }

  return (
    <section className={styles.page}>
      <header
        className={styles.pageHeader}
      >
        <div>
          <div
            className={
              styles.eyebrow
            }
          >
            <LockKeyhole
              size={13}
              aria-hidden="true"
            />
            Access control
          </div>

          <h1>Team & Roles</h1>

          <p>
            Manage people, roles, and
            workspace access from one
            control center.
          </p>
        </div>


      </header>

      <div
        className={
          styles.summaryStrip
        }
      >
        <div>
          <strong>
            {TEAM_MEMBERS.length}
          </strong>
          <span>Members</span>
        </div>

        <div>
          <strong>
            {ROLE_ORDER.length}
          </strong>
          <span>Roles</span>
        </div>

        <div>
          <strong>
            {roleCounts.Owner}
          </strong>
          <span>Owner</span>
        </div>

        <div
          className={
            styles.summaryNote
          }
        >
          <ShieldCheck
            size={15}
            aria-hidden="true"
          />
          Role changes are preview-only
          until backend connection.
        </div>
      </div>

      <div
        className={styles.viewBar}
      >
        <button
          type="button"
          className={
            view === "team"
              ? styles.viewActive
              : styles.viewButton
          }
          onClick={() => {
            setView("team");
            setNotice(null);
          }}
        >
          <UsersRound
            size={15}
            aria-hidden="true"
          />
          Team directory
        </button>

        <button
          type="button"
          className={
            view === "roles"
              ? styles.viewActive
              : styles.viewButton
          }
          onClick={() => {
            setView("roles");
            setNotice(null);
          }}
        >
          <SlidersHorizontal
            size={15}
            aria-hidden="true"
          />
          Roles & permissions
        </button>
      </div>

      {notice ? (
        <div className={styles.notice}>
          {notice}

          <button
            type="button"
            onClick={() =>
              setNotice(null)
            }
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {view === "team" ? (
        <div
          className={
            styles.teamWorkspace
          }
        >
          <section
            className={
              styles.directoryPanel
            }
          >
            <div
              className={
                styles.panelHeader
              }
            >
              <div>
                <h2>
                  Team directory
                </h2>
                <p>
                  Wolf Forge workspace
                  members.
                </p>
              </div>

              <button
                type="button"
                className={styles.directoryAddButton}
                onClick={() =>
                  setNotice(
                    "Add user is frontend-only for now.",
                  )
                }
              >
                <UserPlus
                  size={14}
                  aria-hidden="true"
                />
                Add user
              </button>
            </div>

            <div
              className={
                styles.searchRow
              }
            >
              <Search
                size={15}
                aria-hidden="true"
              />

              <input
                type="search"
                placeholder="Search people, email, or role"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
              />
            </div>

            <div
              className={
                styles.teamList
              }
            >
              {filteredTeam.map(
                (member) => (
                  <div
                    className={
                      styles.teamRow
                    }
                    key={member.id}
                  >
                    <div
                      className={
                        styles.avatar
                      }
                    >
                      {initials(
                        member.name,
                      )}
                    </div>

                    <div
                      className={
                        styles.memberCopy
                      }
                    >
                      <strong>
                        {member.name}
                      </strong>
                      <span>
                        {member.email}
                      </span>
                    </div>

                    <button
                      type="button"
                      className={`${styles.rolePill} ${roleClass(
                        member.role,
                      )}`}
                      onClick={() =>
                        openRole(
                          member.role,
                        )
                      }
                    >
                      {member.role}
                    </button>

                    <button
                      type="button"
                      className={
                        styles.moreButton
                      }
                      aria-label={`Actions for ${member.name}`}
                      onClick={() =>
                        setNotice(
                          `${member.name}'s account controls will connect later.`,
                        )
                      }
                    >
                      <MoreHorizontal
                        size={17}
                      />
                    </button>
                  </div>
                ),
              )}

              {filteredTeam.length ===
              0 ? (
                <div
                  className={
                    styles.noResults
                  }
                >
                  No team members match
                  â€œ{search}â€.
                </div>
              ) : null}
            </div>
          </section>

          <aside
            className={
              styles.roleMap
            }
          >
            <div
              className={
                styles.roleMapHeader
              }
            >
              <div>
                <h2>Role map</h2>
                <p>
                  Access presets and
                  current assignment.
                </p>
              </div>

              <ShieldCheck
                size={18}
                aria-hidden="true"
              />
            </div>

            <div
              className={
                styles.roleMapList
              }
            >
              {ROLE_ORDER.map(
                (role) => {
                  const count =
                    roleCounts[role];

                  const access =
                    permissions[role]
                      .length;

                  const percent =
                    Math.round(
                      (access /
                        ALL_PERMISSION_KEYS.length) *
                        100,
                    );

                  return (
                    <button
                      type="button"
                      key={role}
                      className={
                        styles.roleMapRow
                      }
                      onClick={() =>
                        openRole(role)
                      }
                    >
                      <div
                        className={
                          styles.roleMapTop
                        }
                      >
                        <div>
                          <strong>
                            {role}
                          </strong>

                          <span>
                            {count}{" "}
                            {count === 1
                              ? "member"
                              : "members"}
                          </span>
                        </div>

                        <ChevronRight
                          size={15}
                        />
                      </div>

                      <div
                        className={
                          styles.accessMeter
                        }
                      >
                        <span
                          style={{
                            width: `${percent}%`,
                          }}
                        />
                      </div>

                      <small>
                        {access} of{" "}
                        {
                          ALL_PERMISSION_KEYS.length
                        }{" "}
                        permissions
                      </small>
                    </button>
                  );
                },
              )}
            </div>

            <button
              type="button"
              className={
                styles.createRole
              }
              onClick={() =>
                setNotice(
                  "Custom role creation will connect later.",
                )
              }
            >
              <Plus size={14} />
              Create custom role
            </button>
          </aside>
        </div>
      ) : (
        <div
          className={
            styles.rolesWorkspace
          }
        >
          <aside
            className={
              styles.rolesRail
            }
          >
            <div
              className={
                styles.rolesRailTitle
              }
            >
              <span>Role presets</span>

              <button
                type="button"
                onClick={() =>
                  setNotice(
                    "Custom role creation will connect later.",
                  )
                }
                aria-label="Create role"
              >
                <Plus size={15} />
              </button>
            </div>

            {ROLE_ORDER.map(
              (role) => {
                const active =
                  role ===
                  selectedRole;

                return (
                  <button
                    type="button"
                    key={role}
                    className={
                      active
                        ? styles.roleRailActive
                        : styles.roleRailButton
                    }
                    onClick={() => {
                      setSelectedRole(
                        role,
                      );
                      setNotice(null);
                    }}
                  >
                    <div>
                      <strong>
                        {role}
                      </strong>

                      <span>
                        {roleCounts[role]}{" "}
                        members
                      </span>
                    </div>

                    <ChevronRight
                      size={15}
                    />
                  </button>
                );
              },
            )}
          </aside>

          <section
            className={
              styles.permissionPanel
            }
          >
            <div
              className={
                styles.permissionHeader
              }
            >
              <div>
                <div
                  className={
                    styles.permissionTitle
                  }
                >
                  <h2>
                    {selectedRole}
                  </h2>

                  {selectedRole ===
                  "Owner" ? (
                    <span>
                      Locked full access
                    </span>
                  ) : null}
                </div>

                <p>
                  {
                    ROLE_DESCRIPTIONS[
                      selectedRole
                    ]
                  }
                </p>
              </div>

              <div
                className={
                  styles.permissionScore
                }
              >
                <strong>
                  {
                    permissions[
                      selectedRole
                    ].length
                  }
                </strong>
                <span>
                  /{" "}
                  {
                    ALL_PERMISSION_KEYS.length
                  }{" "}
                  active
                </span>
              </div>
            </div>

            <div
              className={
                styles.permissionBody
              }
            >
              {PERMISSION_GROUPS.map(
                (group) => (
                  <div
                    className={
                      styles.permissionGroup
                    }
                    key={group.title}
                  >
                    <div
                      className={
                        styles.groupCopy
                      }
                    >
                      <h3>
                        {group.title}
                      </h3>

                      <p>
                        {
                          group.description
                        }
                      </p>
                    </div>

                    <div
                      className={
                        styles.permissionOptions
                      }
                    >
                      {group.items.map(
                        (item) => {
                          const checked =
                            selectedPermissions.has(
                              item.key,
                            );

                          return (
                            <button
                              type="button"
                              key={
                                item.key
                              }
                              aria-pressed={
                                checked
                              }
                              className={
                                checked
                                  ? styles.permissionOn
                                  : styles.permissionOff
                              }
                              onClick={() =>
                                togglePermission(
                                  item.key,
                                )
                              }
                            >
                              <span>
                                {checked ? (
                                  <Check
                                    size={
                                      12
                                    }
                                    strokeWidth={
                                      3
                                    }
                                  />
                                ) : null}
                              </span>

                              {
                                item.label
                              }
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>

            <footer
              className={
                styles.permissionFooter
              }
            >
              <div>
                <ShieldCheck
                  size={15}
                />

                <span>
                  Changes are local
                  preview only.
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setNotice(
                    `${selectedRole} permission changes are not connected to the database yet.`,
                  )
                }
              >
                Save role
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}