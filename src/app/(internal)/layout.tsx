import { readWorkflowStages } from "../../lib/settings/process";
import { InternalShell } from "../../components/shell/internal-shell";
import { getInternalContext } from "../../lib/supabase/next-server";
import { isLocalQuickAccessSession, localUiQaBypassEnabled } from "../../lib/qa/local-ui-bypass";
import { WhiteLabelPublicationRepository } from "../../repositories/white-label-publication-repository";
import { WhiteLabelPublicationService } from "../../services/white-label-publication-service";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const context = await getInternalContext();
  const runtimeConfigurationPromise = new WhiteLabelPublicationService({
    repository: new WhiteLabelPublicationRepository(context.client),
  }).getRuntimeConfiguration().catch(() => null);

  /*
   * The internal bell's chime honours the same stored preference the client
   * portal's bell already reads, so the toggle on the Profile page controls
   * both. A failed read falls back to sound on, matching the column default.
   */
  const [runtimeConfiguration, profile, tickets, clients] = await Promise.all([
    runtimeConfigurationPromise,

    context.services.profile.getMine().catch(() => null),
    context.user.modules.tickets ? readWorkflowStages("tickets").catch(()=>[]) : [],
    context.user.modules.clients ? readWorkflowStages("clients").catch(()=>[]) : [],
  ]);
  const showWhiteLabel = (await localUiQaBypassEnabled()) &&
    !(await isLocalQuickAccessSession(context.actor)) &&
    context.user.modules.settings === true &&
    (await context.services.permissions.isPlatformAdmin().catch(() => false));

  return (
    <InternalShell
      workflowLabels={{tickets, clients}}
      user={context.user}
      runtimeConfiguration={runtimeConfiguration}
      showWhiteLabel={showWhiteLabel}
      notificationSoundEnabled={profile?.notificationSoundEnabled ?? true}
    >
      {children}
    </InternalShell>
  );
}
