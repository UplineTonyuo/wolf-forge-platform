import "server-only";

import { parseInput } from "../domain/shared";
import {
  toSupervisedConversationPage,
  toSupervisedMessageSearchPage,
  toSupervisedMessageWindow,
  toSupervisedTranscriptPage,
} from "../domain/team-supervision/projections";
import {
  getSupervisedConversationSchema,
  getSupervisedMessageWindowSchema,
  listSupervisedConversationsSchema,
  listSupervisedMessagesBeforeSchema,
  searchSupervisedConversationSchema,
  teamSupervisionListDefaultLimit,
} from "../domain/team-supervision/schema";
import type { TeamSupervisionRepository } from "../repositories/team-supervision-repository";
import type { ServiceDependencies } from "./mutation-context";

/**
 * Read-only Team supervision: validates shape, calls exactly one supervisory
 * RPC, and maps the neutral projection to domain models.
 *
 * It decides no access. `team_messages.supervise`, direct-only eligibility,
 * limits, audit and search throttling are enforced in the database, so no
 * method takes an actor, and constructing this service grants nothing.
 *
 * `correlationId` is optional and passed through when a caller supplies the
 * canonical request id; entry-point wiring belongs to Phase 2B-2.
 */
export class TeamSupervisionService {
  constructor(private readonly dependencies: ServiceDependencies<TeamSupervisionRepository>) {}

  async listConversations(input: unknown = {}) {
    const parsed = parseInput(listSupervisedConversationsSchema, input);
    const rows = await this.dependencies.repository.listConversations(parsed);
    return toSupervisedConversationPage(rows, parsed.limit ?? teamSupervisionListDefaultLimit);
  }

  async getConversation(input: unknown) {
    return toSupervisedTranscriptPage(
      await this.dependencies.repository.getConversation(
        parseInput(getSupervisedConversationSchema, input),
      ),
    );
  }

  async listMessagesBefore(input: unknown) {
    return toSupervisedTranscriptPage(
      await this.dependencies.repository.listMessagesBefore(
        parseInput(listSupervisedMessagesBeforeSchema, input),
      ),
    );
  }

  async getMessageWindow(input: unknown) {
    return toSupervisedMessageWindow(
      await this.dependencies.repository.getMessageWindow(
        parseInput(getSupervisedMessageWindowSchema, input),
      ),
    );
  }

  async searchConversation(input: unknown) {
    return toSupervisedMessageSearchPage(
      await this.dependencies.repository.searchConversation(
        parseInput(searchSupervisedConversationSchema, input),
      ),
    );
  }
}
