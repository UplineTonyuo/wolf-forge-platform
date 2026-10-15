import { parseInput } from "../domain/shared";
import { preflightWhiteLabelPublicationSchema, publishWhiteLabelSchema, type PublishWhiteLabelInput } from "../domain/white-label/publication";
import type { WhiteLabelPublicationRepository } from "../repositories/white-label-publication-repository";
import type { ServiceDependencies } from "./mutation-context";

export class WhiteLabelPublicationService {
  constructor(private readonly dependencies: ServiceDependencies<WhiteLabelPublicationRepository>) {}

  getRuntimeConfiguration() { return this.dependencies.repository.getRuntimeConfiguration(); }
  preflight(input: Pick<PublishWhiteLabelInput, "tenantId" | "sourceDraftRevision" | "expectedPublicationRevision">) {
    return this.dependencies.repository.preflight(parseInput(preflightWhiteLabelPublicationSchema, input));
  }
  publish(input: PublishWhiteLabelInput) {
    return this.dependencies.repository.publish(parseInput(publishWhiteLabelSchema, input));
  }
  reconcile(input: PublishWhiteLabelInput) {
    return this.dependencies.repository.reconcile(parseInput(publishWhiteLabelSchema, input));
  }
}
