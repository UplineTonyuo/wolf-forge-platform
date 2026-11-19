import type { Order } from "../../domain/orders/schema";
import { projectStatusLabels } from "../../domain/orders/projections";
import { orderStage, type ProcessEntry } from "../../domain/process/settings";

export function StatusBadge({ order, stages }: {
  order: Pick<Order, "status" | "process_stage">;
  stages: ProcessEntry[];
}) {
  const stage = orderStage(stages, order.status, order.process_stage);
  return (
    <span className={`status-badge status-${order.status}`} title={stage?.description}
      style={stage ? { borderInlineStart: `3px solid ${stage.color}` } : undefined}>
      {stage?.name ?? projectStatusLabels[order.status]}
    </span>
  );
}
