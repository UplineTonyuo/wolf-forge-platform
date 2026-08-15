import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TeamRolesPanel } from "../../../components/settings/team-roles-panel";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getInternalContext } from "../../../lib/supabase/next-server";
import type {
  InternalMember,
  PermissionPresetGrant,
  PermissionPresetOverview,
} from "../../../domain/permissions/schema";

export const metadata: Metadata = {
  title: "Team & Roles",
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { user, services } = await getInternalContext();
  const params = await searchParams;

  let members: InternalMember[] = [];
  let presets: PermissionPresetOverview[] = [];
  let grants: PermissionPresetGrant[] = [];
  let denied = false;
  let loadError: string | null = null;

  try {
    /*
     * The module boundary is the authority, not the sidebar. Typing the URL
     * reaches this call and is rejected the same way a hidden nav item is.
     */
    await services.permissions.requireModuleAccess("team");

    [members, presets, grants] = await Promise.all([
      services.permissions.listInternalMembers(),
      services.permissions.listPresetOverview(),
      services.permissions.listPresetGrants(),
    ]);
  } catch (error) {
    const safe = toClientSafeError(error);

    if (safe.code === "PERMISSION_DENIED") {
      denied = true;
    } else {
      loadError = safe.message || "Team access could not be loaded.";
    }
  }

  // redirect() throws its own control-flow error, so it stays outside the catch.
  if (denied) {
    redirect("/");
  }

  if (loadError) {
    return (
      <PageFrame title="Team & Roles">
        <div className="clients-load-error" role="alert">
          <strong>Team access could not be loaded.</strong>
          <span>{loadError}</span>
        </div>
      </PageFrame>
    );
  }

  return (
    <TeamRolesPanel
      members={members}
      presets={presets}
      grants={grants}
      canAddMembers={user.team.create && user.team.managePermissions}
      canManagePermissions={user.team.managePermissions}
      createdMember={params.created === "1"}
    />
  );
}
