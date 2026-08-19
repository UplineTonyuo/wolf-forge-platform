import { forbidden } from "next/navigation";
import { getInternalContext } from "../../../lib/supabase/next-server";

/*
 * Presentation-level rejection so a typed URL does not render a screen that
 * cannot succeed. The real boundary is app_require_module_access('dashboard')
 * inside app_dashboard_overview, which re-authorizes against auth.uid() and
 * also verifies the caller's account class.
 *
 * modules.dashboard comes from public.permission_modules, whose internal row
 * requires dashboard.executive_view — granted to owner and admin only.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getInternalContext();
  if (!user.modules.dashboard) forbidden();
  return children;
}
