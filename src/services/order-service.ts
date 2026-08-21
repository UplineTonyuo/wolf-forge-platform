import { composeClientProjectViews, type ClientProjectView } from "../domain/orders/client-projections";
import { composeProjectRows, type ProjectListRow, type ProjectRelationRow } from "../domain/orders/projections";
import { changeOrderStatusSchema, createOrderSchema, updateOrderSchema } from "../domain/orders/schema";
import { parseInput, uuidSchema } from "../domain/shared";
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
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  list(filter?: ListOrdersFilter) { return this.dependencies.repository.list(filter); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }

  async getWithRelations(id: unknown): Promise<ProjectRelationRow> {
    return this.dependencies.repository.getWithRelations(parseInput(uuidSchema, id));
  }

  async listLabels(ids: string[]): Promise<ProjectLabelRow[]> {
    return this.dependencies.repository.listLabels(ids.map((id) => parseInput(uuidSchema, id)));
  }

  /**
   * The authoritative Projects read model: one embedded query for the projects
   * plus one batched query for their tasks, regardless of row count.
   */
  async listProjects(filter?: ListOrdersFilter): Promise<ProjectListResult> {
    const page = await this.dependencies.repository.listWithRelations(filter);
    const taskFacts = await this.dependencies.repository.listTaskFacts(page.rows.map((row) => row.id));

    return {
      rows: composeProjectRows(page.rows, taskFacts),
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

  async changeStatus(id: unknown, input: unknown, actor: UserMutationActor) {
    const orderId = parseInput(uuidSchema, id);
    const requested = parseInput(changeOrderStatusSchema, input);
    requireVerifiedActor(actor);
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
