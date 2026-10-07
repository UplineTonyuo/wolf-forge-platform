import {
  assignFormSchema,
  correctFormSubmissionSchema,
  createFormSchema,
  formCanonicalKeySchema,
  formRequestSchema,
  submitFormSchema,
  updateFormDraftSchema,
} from "../domain/forms/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { FormRepository } from "../repositories/form-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class FormService {
  constructor(private readonly dependencies: ServiceDependencies<FormRepository>) {}

  list() {
    return this.dependencies.repository.list();
  }

  get(id: unknown) {
    return this.dependencies.repository.getById(parseInput(uuidSchema, id));
  }

  getPublishedSchema(canonicalKey: unknown) {
    return this.dependencies.repository.getPublishedSchema(
      parseInput(formCanonicalKeySchema, canonicalKey),
    );
  }

  getVersion(formId: unknown, versionId: unknown) {
    return this.dependencies.repository.getVersionDefinition(
      parseInput(uuidSchema, formId),
      parseInput(uuidSchema, versionId),
    );
  }

  getVersionSchema(formId: unknown, versionId: unknown) {
    return this.dependencies.repository.getVersionSchema(
      parseInput(uuidSchema, formId),
      parseInput(uuidSchema, versionId),
    );
  }

  listAssignments() {
    return this.dependencies.repository.listAssignments();
  }

  /** Active client members of the current Tenant with an active Client. */
  listOnboardingCandidates(companyId?: unknown) {
    return this.dependencies.repository.listOnboardingCandidates(
      companyId == null ? undefined : parseInput(uuidSchema, companyId),
    );
  }

  getAssignedForm(id: unknown) {
    return this.dependencies.repository.getAssignedForm(parseInput(uuidSchema, id));
  }

  listSubmissions(formId?: unknown, orderId?: unknown) {
    return this.dependencies.repository.listSubmissions(
      formId == null ? undefined : parseInput(uuidSchema, formId),
      orderId == null ? undefined : parseInput(uuidSchema, orderId),
    );
  }

  create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createFormSchema, input));
  }

  updateDraft(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updateDraft(
      parseInput(uuidSchema, id),
      parseInput(updateFormDraftSchema, input),
    );
  }

  publish(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    const request = parseInput(formRequestSchema, input);
    return this.dependencies.repository.publish(parseInput(uuidSchema, id), request.request_id);
  }

  archive(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    const request = parseInput(formRequestSchema, input);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id), request.request_id);
  }

  assign(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.assign(
      parseInput(uuidSchema, id),
      parseInput(assignFormSchema, input),
    );
  }

  submit(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.submit(parseInput(submitFormSchema, input));
  }

  correct(submissionId: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.correct(
      parseInput(uuidSchema, submissionId),
      parseInput(correctFormSubmissionSchema, input),
    );
  }

  getSubmission(id: unknown) {
    return this.dependencies.repository.getSubmission(parseInput(uuidSchema, id));
  }
}
