import { parseInput } from "../domain/shared";
import {
  addTeamConversationMemberSchema,
  createTeamTaskSchema,
  createTeamGroupSchema,
  forwardTeamMessageSchema,
  grantTeamConversationAdminSchema,
  removeTeamConversationMemberSchema,
  renameTeamConversationSchema,
  revokeTeamConversationAdminSchema,
  searchTeamConversationMessagesSchema,
  sendTeamMessageSchema,
  sendTeamReplySchema,
  setTeamConversationSlowModeSchema,
  setTeamTaskCreationPolicySchema,
  startTeamConversationSchema,
  teamConversationIdSchema,
  teamLiveRequestSchema,
  teamMessagesBeforeSchema,
  teamMessageWindowSchema,
  teamMessageIdSchema,
  teamPresenceConnectionSchema,
  teamTypingConnectionSchema,
  toggleTeamMessageReactionSchema,
  updateTeamTaskDetailsSchema,
  updateTeamTaskStatusSchema,
} from "../domain/team/schema";
import type { TeamRepository } from "../repositories/team-repository";
import {
  requireVerifiedActor,
  type ServiceDependencies,
  type UserMutationActor,
} from "./mutation-context";

/**
 * Internal team communication orchestration.
 *
 * This service validates shapes and keeps the actor branded as server-verified.
 * It decides no access of its own: conversation membership, the messaging
 * capability, task management rights and the client-account refusal are all
 * settled inside the database, so constructing this service grants nothing.
 *
 * Reads deliberately do not take an actor. There is no actor-shaped parameter
 * to forge, because every read RPC resolves the subject from auth.uid().
 */
export class TeamService {
  constructor(private readonly dependencies: ServiceDependencies<TeamRepository>) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  liveSync(input: unknown) {
    return this.dependencies.repository.liveSync(parseInput(teamLiveRequestSchema, input));
  }

  listMembers() {
    return this.dependencies.repository.listMembers();
  }

  listConversations() {
    return this.dependencies.repository.listConversations();
  }

  unreadCount() {
    return this.dependencies.repository.unreadCount();
  }

  materializeMessageDigests() {
    return this.dependencies.repository.materializeMessageDigests();
  }

  getConversation(input: unknown) {
    return this.dependencies.repository.getConversation(
      parseInput(teamConversationIdSchema, input),
    );
  }

  listMyTasks(includeTeam = false) {
    return this.dependencies.repository.listMyTasks(includeTeam);
  }

  listMessagesBefore(input: unknown) {
    return this.dependencies.repository.listMessagesBefore(
      parseInput(teamMessagesBeforeSchema, input),
    );
  }

  getMessageWindow(input: unknown) {
    return this.dependencies.repository.getMessageWindow(
      parseInput(teamMessageWindowSchema, input),
    );
  }

  searchMessages(input: unknown) {
    return this.dependencies.repository.searchMessages(
      parseInput(searchTeamConversationMessagesSchema, input),
    );
  }

  touchPresence(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.touchPresence(
      parseInput(teamPresenceConnectionSchema, input),
    );
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  startConversation(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.startConversation(
      parseInput(startTeamConversationSchema, input),
    );
  }

  createGroup(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.createGroup(parseInput(createTeamGroupSchema, input));
  }

  sendMessage(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.sendMessage(parseInput(sendTeamMessageSchema, input));
  }

  sendReply(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.sendReply(parseInput(sendTeamReplySchema, input));
  }

  forwardMessage(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.forwardMessage(
      parseInput(forwardTeamMessageSchema, input),
    );
  }

  hideMessageForMe(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.hideMessageForMe(parseInput(teamMessageIdSchema, input));
  }

  deleteMessageForEveryone(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.deleteMessageForEveryone(
      parseInput(teamMessageIdSchema, input),
    );
  }

  toggleReaction(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.toggleReaction(
      parseInput(toggleTeamMessageReactionSchema, input),
    );
  }

  markRead(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.markRead(parseInput(teamConversationIdSchema, input));
  }

  disconnectPresence(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.disconnectPresence(
      parseInput(teamPresenceConnectionSchema, input),
    );
  }

  touchTyping(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.touchTyping(
      parseInput(teamTypingConnectionSchema, input),
    );
  }

  clearTyping(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.clearTyping(
      parseInput(teamTypingConnectionSchema, input),
    );
  }

  createTask(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.createTask(parseInput(createTeamTaskSchema, input));
  }

  updateTaskStatus(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updateTaskStatus(
      parseInput(updateTeamTaskStatusSchema, input),
    );
  }

  updateTaskDetails(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updateTaskDetails(
      parseInput(updateTeamTaskDetailsSchema, input),
    );
  }

  // ---------------------------------------------------------------------------
  // Governance (V2.6)
  // ---------------------------------------------------------------------------

  renameConversation(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.renameConversation(
      parseInput(renameTeamConversationSchema, input),
    );
  }

  setSlowMode(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.setSlowMode(
      parseInput(setTeamConversationSlowModeSchema, input),
    );
  }

  setTaskCreationPolicy(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.setTaskCreationPolicy(
      parseInput(setTeamTaskCreationPolicySchema, input),
    );
  }

  grantAdmin(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.grantAdmin(
      parseInput(grantTeamConversationAdminSchema, input),
    );
  }

  revokeAdmin(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.revokeAdmin(
      parseInput(revokeTeamConversationAdminSchema, input),
    );
  }

  addMember(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.addMember(
      parseInput(addTeamConversationMemberSchema, input),
    );
  }

  removeMember(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.removeMember(
      parseInput(removeTeamConversationMemberSchema, input),
    );
  }
}
