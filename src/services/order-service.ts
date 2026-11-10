import { composeClientProjectViews, type ClientProjectView } from "../domain/orders/client-projections";
import { composeProjectRows, type ProjectListRow, type ProjectRelationRow } from "../domain/orders/projections";
import { changeOrderStatusSchema, createOrderSchema, updateOrderSchema } from "../domain/orders/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { reportCompletionScopeSchema } from "../domain/reporting/order-completion";
import { OrderRepository, type ProjectLabelRow } from "../repositories/order-repository";
import type { ListOrdersFilter } from "../repositories/types";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export type ProjectListResult = {
  rows: ProjectListRow[];
  /**
   * False when the row limit clipped the authorized dataset. Callers must then
   * surface an incomplete-data state instead of presenting partial totals.
   */
  complete: boolean;
  totalCount: number | null;
};

export class OrderService {
  constructor(private readonly dependencies: ServiceDependencies<OrderRepository>) {}
  async listClientResponseStates(ids: string[]) {
    return this.dependencies.repository.listClientResponseStates(ids.map((id) => parseInput(uuidSchema, id)));
  }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  list(filter?: ListOrdersFilter) { return this.dependencies.repository.list(filter); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }
  getClientStartState(id: unknown) { return this.dependencies.repository.getClientStartState(parseInput(uuidSchema, id)); }
  requestClientStart(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.requestClientStart(parseInput(uuidSchema, id));
  }

  async getWithRelations(id: unknown): Promise<ProjectRelationRow> {
    return this.dependencies.repository.getWithRelations(parseInput(uuidSchema, id));
  }

  async listLabels(ids: string[]): Promise<ProjectLabelRow[]> {
    return this.dependencies.repository.listLabels(ids.map((id) => parseInput(uuidSchema, id)));
  }

  /**
   * One order query plus bounded task and public-response metadata batches.
   */
  async listProjects(filter?: ListOrdersFilter): Promise<ProjectListResult> {
    const page = await this.dependencies.repository.listRelationRows(filter);
    const ids = page.rows.map((row) => row.id);
    const [rows, taskFacts, responseStates] = await Promise.all([
      this.dependencies.repository.hydrateMissingAssignees(page.rows),
      this.dependencies.repository.listTaskFacts(ids),
      this.dependencies.repository.listResponseStates(ids).catch(() => []),
    ]);

    return {
      rows: composeProjectRows(rows, taskFacts, new Date(), responseStates),
      complete: page.totalCount === null || page.totalCount <= page.rows.length,
      totalCount: page.totalCount,
    };
  }

  /**
   * The client portal Projects read model. Company scoping stays with RLS; the
   * repository selects a narrow column list and only aggregate task facts, so
   * internal notes, staff identity and task titles never enter the projection.
   */
  async listClientProjects(): Promise<ClientProjectView[]> {
    const rows = await this.dependencies.repository.listForClientPortal();
    return composeClientProjectViews(rows);
  }

  async getClientProject(id: unknown): Promise<ClientProjectView> {
    const projectId = parseInput(uuidSchema, id);
    const row = await this.dependencies.repository.getForClientPortal(projectId);
    const [view] = composeClientProjectViews([row]);
    return view as ClientProjectView;
  }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createOrderSchema, input));
  }

  async update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(updateOrderSchema, input),
    );
  }

  async setReportingMonth(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.setReportingMonth(parseInput(uuidSchema, id), parseInput(reportCompletionScopeSchema, input));
  }

  async completeForReportingMonth(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.completeForReportingMonth(parseInput(uuidSchema, id), parseInput(reportCompletionScopeSchema, input));
  }

  async changeStatus(id: unknown, input: unknown, actor: UserMutationActor) {
    const orderId = parseInput(uuidSchema, id);
    const requested = parseInput(changeOrderStatusSchema, input);
    requireVerifiedActor(actor);
    if (requested.reportException) return this.dependencies.repository.completeWithoutReport(orderId, requested.reportException);
    return this.dependencies.repository.changeStatus(orderId, requested.status);
  }

  async assign(id: unknown, profileId: unknown, actor: UserMutationActor) {
    const assignee = parseInput(uuidSchema.nullable(), profileId);
    requireVerifiedActor(actor);
    return this.dependencies.repository.assign(parseInput(uuidSchema, id), assignee);
  }

  async archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }
}
