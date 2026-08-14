export const PROJECTS_SELECTION_EVENT = "wolf-forge:projects-selection";
export const PROJECTS_BULK_ACTION_EVENT = "wolf-forge:projects-bulk-action";

export type ProjectBulkActionKind = "assign" | "status" | "archive";

export type ProjectSelectionDetail = {
  count: number;
};

export type ProjectBulkActionDetail = {
  kind: ProjectBulkActionKind;
};