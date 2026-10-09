import { redirect } from "next/navigation";
import { SettingsShell } from "../../../components/settings/settings-navigation";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { localUiQaBypassEnabled } from "../../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const context = await getInternalContext();
  let denied = false;

  try {
    await context.services.permissions.requireModuleAccess("settings");
  } catch (error) {
    if (toClientSafeError(error).code === "PERMISSION_DENIED") denied = true;
    else throw error;
  }

  if (denied) redirect("/");

  const showWhiteLabel = await localUiQaBypassEnabled();

  return (
    <div className="settings-page-layout">
      <PageFrame
        title="Settings"
        description="Workspace configuration, access boundaries, and external provider readiness."
      >
        <SettingsShell showWhiteLabel={showWhiteLabel}>{children}</SettingsShell>
      </PageFrame>
    </div>
  );
}
