import { randomUUID } from "node:crypto";
import {
  provisionClientAccountSchema,
  provisionInternalMemberSchema,
  type PermissionOverrideInput,
  type ProvisionedAccount,
} from "../domain/permissions/schema";
import { parseInput } from "../domain/shared";
import { AuthAdminError, type AuthAdminAdapter } from "../lib/supabase/auth-admin";
import type { CompanyRepository } from "../repositories/company-repository";
import type { ContactRepository } from "../repositories/contact-repository";
import type { PermissionRepository } from "../repositories/permission-repository";
import { requireVerifiedActor, type UserMutationActor } from "./mutation-context";

export type AccountProvisioningDependencies = {
  permissions: PermissionRepository;
  companies: CompanyRepository;
  contacts: ContactRepository;
  authAdmin: AuthAdminAdapter;
};

function displayNameFor(input: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
}): string {
  const explicit = input.display_name?.trim();
  if (explicit) return explicit;

  const composed = [input.first_name, input.last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");

  return composed || input.email;
}

/**
 * Wolf Forge member and client portal provisioning share one implementation of
 * the fragile part — creating an auth user outside the database transaction and
 * compensating when the database half fails — but they remain two separate
 * authorization paths. Company creation stays untouched on its own boundary.
 */
export class AccountProvisioningService {
  constructor(private readonly dependencies: AccountProvisioningDependencies) {}

  /**
   * Adds a Wolf Forge member. The database RPC re-authorizes the session actor,
   * rejects any non-internal preset, and audits `account.member_created`.
   */
  async provisionInternalMember(
    input: unknown,
    actor: UserMutationActor,
  ): Promise<ProvisionedAccount> {
    requireVerifiedActor(actor);
    const parsed = parseInput(provisionInternalMemberSchema, input);
    const displayName = displayNameFor(parsed);
    const overrides: PermissionOverrideInput[] = parsed.overrides ?? [];

    const authUser = await this.dependencies.authAdmin.createUser({
      email: parsed.email,
      password: parsed.temporary_password,
      displayName,
    });

    try {
      const profile = await this.dependencies.permissions.provisionInternalMemberProfile(
        authUser.id,
        parsed.preset_key,
        displayName,
        overrides,
      );

      return { profile, companyId: null };
    } catch (error) {
      await this.rollbackAuthUser(authUser.id);
      throw error;
    }
  }

  /**
   * Adds a client portal account against a real company. An existing company id
   * is linked as-is; a name provisions one through the ordinary company path so
   * the relationship is never faked.
   */
  async provisionClientAccount(
    input: unknown,
    actor: UserMutationActor,
  ): Promise<ProvisionedAccount> {
    requireVerifiedActor(actor);
    const parsed = parseInput(provisionClientAccountSchema, input);
    const displayName = displayNameFor(parsed);
    const overrides: PermissionOverrideInput[] = parsed.overrides ?? [];

    const authUser = await this.dependencies.authAdmin.createUser({
      email: parsed.email,
      password: parsed.temporary_password,
      displayName,
    });

    let createdCompanyId: string | null = null;

    try {
      let companyId = parsed.company_id ?? null;

      if (!companyId) {
        const company = await this.dependencies.companies.create({
          request_id: parsed.company_request_id ?? randomUUID(),
          name: parsed.company_name as string,
        });
        companyId = company.id;
        createdCompanyId = company.id;
      }

      const profile = await this.dependencies.permissions.provisionClientAccountProfile(
        authUser.id,
        companyId,
        displayName,
        overrides,
      );

      const existingContacts = await this.dependencies.contacts.listForCompany(companyId);

      await this.dependencies.contacts.create({
        request_id: parsed.contact_request_id ?? randomUUID(),
        company_id: companyId,
        name: displayName,
        profile_id: authUser.id,
        email: parsed.email,
        phone: parsed.phone ?? undefined,
        job_title: parsed.job_title ?? undefined,
        is_primary: existingContacts.length === 0,
      });

      return { profile, companyId };
    } catch (error) {
      // Auth users live outside the Postgres transaction, so partial creation is
      // compensated through the ordinary audited boundaries.
      if (createdCompanyId) {
        await this.dependencies.companies.archive(createdCompanyId).catch(() => undefined);
      }
      await this.rollbackAuthUser(authUser.id);
      throw error;
    }
  }

  private async rollbackAuthUser(userId: string): Promise<void> {
    try {
      await this.dependencies.authAdmin.deleteUser(userId);
    } catch {
      // Best-effort compensation only; the database boundary is authoritative.
    }
  }
}

export { AuthAdminError };
