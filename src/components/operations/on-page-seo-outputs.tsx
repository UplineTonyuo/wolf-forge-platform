import type { OnPageSeoDeliverable } from "../../domain/operations/on-page-seo-workflow";
import { DepartmentOutputs } from "./department-outputs";

export function OnPageSeoOutputs({ deliverables }: { deliverables: readonly OnPageSeoDeliverable[] }) {
  return <DepartmentOutputs resources={deliverables} />;
}
