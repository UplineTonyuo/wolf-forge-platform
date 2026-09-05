import type { ReactNode } from "react";
import { OperationsTabs } from "../../../components/operations/operations-tabs";
import { PageFrame } from "../../../components/ui/page-frame";

/**
 * "To Do" is now Operations: the existing SPP task engine (Tasks) plus new
 * read-only external department workflow data (Departments). The route
 * stays `/todo` and the navigation id/module key stays "todo" — renaming
 * either would need a hosted `public.permission_modules` change, which this
 * phase does not touch. Only the user-facing label changed
 * (`components/shell/nav-registry.ts`).
 */
export default function OperationsLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="Operations" description="Tasks that need attention, and read-only department workflow data.">
      <OperationsTabs />
      <div className="operations-tab-panel">{children}</div>
    </PageFrame>
  );
}
