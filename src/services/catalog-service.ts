import {
  createServiceFolderSchema,
  createServiceSchema,
  updateServiceFolderSchema,
  updateServiceSchema,
} from "../domain/services/schema";
import {
  composeStoreCatalog,
  toStoreServiceView,
  type StoreCatalog,
  type StoreServiceView,
} from "../domain/services/store-projections";
import { parseInput, uuidSchema } from "../domain/shared";
import { ServiceRepository } from "../repositories/service-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class CatalogService {
  constructor(private readonly dependencies: ServiceDependencies<ServiceRepository>) {}

  get(id: unknown) {
    return this.dependencies.repository.getById(parseInput(uuidSchema, id));
  }

  listActive() {
    return this.dependencies.repository.listActive();
  }

  listCatalog() {
    return this.dependencies.repository.listCatalog();
  }

  listFolders() {
    return this.dependencies.repository.listFolders();
  }

  /**
   * The client Store catalog, composed from the same tables the internal
   * Services module reads. There is no second catalog and no client-only
   * service table; only the projection differs.
   */
  async listStoreCatalog(): Promise<StoreCatalog> {
    const [folders, services] = await Promise.all([
      this.dependencies.repository.listFolders(),
      this.dependencies.repository.listStoreServices(),
    ]);

    return composeStoreCatalog(folders, services);
  }

  async getStoreService(id: unknown): Promise<StoreServiceView> {
    return toStoreServiceView(
      await this.dependencies.repository.getStoreService(parseInput(uuidSchema, id)),
    );
  }

  getFolder(id: unknown) {
    return this.dependencies.repository.getFolderById(parseInput(uuidSchema, id));
  }

  listAssignees() {
    return this.dependencies.repository.listAssignees();
  }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createServiceSchema, input));
  }

  async update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(updateServiceSchema, input),
    );
  }

  async duplicate(id: unknown, requestId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.duplicate(
      parseInput(uuidSchema, id),
      parseInput(uuidSchema, requestId),
    );
  }

  async archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }

  async createFolder(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.createFolder(parseInput(createServiceFolderSchema, input));
  }

  async updateFolder(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updateFolder(
      parseInput(uuidSchema, id),
      parseInput(updateServiceFolderSchema, input),
    );
  }

  async setFolderSubscriptionEligibility(id: unknown, eligible: boolean, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.setFolderSubscriptionEligibility(parseInput(uuidSchema, id), eligible);
  }

  async archiveFolder(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archiveFolder(parseInput(uuidSchema, id));
  }
}
