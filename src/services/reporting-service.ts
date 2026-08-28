import { z } from "zod";
import {
  createReportDraftSchema,
  reportStatusSchema,
  saveReportDraftSchema,
  sendClientReportSchema,
  sendReportDraftSchema,
} from "../domain/reporting/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import type { ReportingRepository } from "../repositories/reporting-repository";
import {
  requireVerifiedActor,
  type ServiceDependencies,
  type UserMutationActor,
} from "./mutation-context";

/**
 * Reporting orchestration.
 *
 * Validates shapes and keeps the actor branded as server-verified. It decides
 * no access of its own: sending re-checks for an internal actor holding
 * reports.send inside the database, and every read derives the company from
 * auth.uid() rather than from anything a caller supplies.
 */
export class ReportingService {
  constructor(private readonly dependencies: ServiceDependencies<ReportingRepository>) {}

  send(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.send(parseInput(sendClientReportSchema, input));
  }

  listMine(limit?: number) {
    return this.dependencies.repository.listMine(limit);
  }

  /** The report id is request data; the database derives company authority. */
  getMine(reportId: unknown) {
    return this.dependencies.repository.getMine(parseInput(uuidSchema, reportId));
  }

  markRead(reportId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.markRead(parseInput(uuidSchema, reportId));
  }

  countUnread() {
    return this.dependencies.repository.countUnread();
  }

  /* ---------------------------------------------------------------------------
   * The internal builder
   * ------------------------------------------------------------------------ */

  createDraft(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.createDraft(
      parseInput(createReportDraftSchema, input),
    );
  }

  saveDraft(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.saveDraft(parseInput(saveReportDraftSchema, input));
  }

  sendDraft(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.sendDraft(parseInput(sendReportDraftSchema, input));
  }

  /** Presentation-only; re-checks reports.send inside the database. */
  getSendStatus(reportId: unknown) {
    return this.dependencies.repository.getSendStatus(parseInput(uuidSchema, reportId));
  }

  discardDraft(reportId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.discardDraft(parseInput(uuidSchema, reportId));
  }

  /** An unrecognised status is refused here rather than widening the RPC filter. */
  listInternal(status?: unknown, limit?: number) {
    const parsed = status === undefined ? undefined : parseInput(reportStatusSchema, status);
    return this.dependencies.repository.listInternal(parsed, limit);
  }

  getInternal(reportId: unknown) {
    return this.dependencies.repository.getInternal(parseInput(uuidSchema, reportId));
  }

  listServiceOptions(companyId: unknown, supportedServiceIds: unknown) {
    return this.dependencies.repository.listServiceOptions(
      parseInput(uuidSchema, companyId),
      parseInput(z.array(uuidSchema).min(1), supportedServiceIds),
    );
  }

  listReportedOneTimeDeliverables(input: unknown) {
    const parsed = parseInput(
      z.object({
        companyId: uuidSchema,
        serviceId: uuidSchema,
        subscriptionId: uuidSchema.nullable(),
      }),
      input,
    );
    return this.dependencies.repository.listReportedOneTimeDeliverables(parsed);
  }
}
