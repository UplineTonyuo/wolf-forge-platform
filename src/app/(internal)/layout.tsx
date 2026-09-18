import { InternalShell } from "../../components/shell/internal-shell";
import { getInternalContext } from "../../lib/supabase/next-server";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const context = await getInternalContext();

  /*
   * The internal bell's chime honours the same stored preference the client
   * portal's bell already reads, so the toggle on the Profile page controls
   * both. A failed read falls back to sound on, matching the column default.
   */
  const profile = await context.services.profile.getMine().catch(() => null);

  return (
    <InternalShell
      user={context.user}
      notificationSoundEnabled={profile?.notificationSoundEnabled ?? true}
    >
      {children}
    </InternalShell>
  );
}
