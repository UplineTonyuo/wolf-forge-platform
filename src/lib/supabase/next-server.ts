import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readPublicEnvironment } from "../env/public-env";
import { readServerEnvironment } from "../env/server-env";
import type { ProjectCapabilities } from "../../domain/orders/projections";
import type { InvoiceCapabilities } from "../../domain/invoices/schema";
import type { SubscriptionCapabilities } from "../../domain/subscriptions/schema";
import type { FormCapabilities } from "../../domain/forms/schema";
import type { TicketCapabilities } from "../../domain/tickets/schema";
import { toModuleAccessMap, type ModuleAccess } from "../../domain/permissions/schema";
import type { Database } from "./database.types";
import { hardenAuthCookieOptions } from "./auth-cookie-options";
import { currentCorrelationId } from "../security/request-correlation";
import { recordSecurityAuditEvent } from "../security/security-audit-log";
import { recordSecurityEvent } from "../security/security-log";
import { createUserSupabaseClient, verifyActor, type UserScopedClient, type VerifiedActor } from "./user-client";
import { ActivityRepository } from "../../repositories/activity-repository";
import { CompanyRepository } from "../../repositories/company-repository";
import { OrganizationRepository } from "../../repositories/organization-repository";
import { DashboardRepository } from "../../repositories/dashboard-repository";
import { CompanyWalletRepository } from "../../repositories/company-wallet-repository";
import { ContactRepository } from "../../repositories/contact-repository";
import { CouponRepository } from "../../repositories/coupon-repository";
import { OrderRepository } from "../../repositories/order-repository";
import { InvoiceRepository } from "../../repositories/invoice-repository";
import { WfCardRepository } from "../../repositories/wf-card-repository";
import { ServiceRepository } from "../../repositories/service-repository";
import { ReportingRepository } from "../../repositories/reporting-repository";
import { StoreInterestRepository } from "../../repositories/store-interest-repository";
import { SubscriptionRepository } from "../../repositories/subscription-repository";
import { FormRepository } from "../../repositories/form-repository";
import { TicketRepository } from "../../repositories/ticket-repository";
import { ProjectConversationRepository } from "../../repositories/project-conversation-repository";
import { PermissionRepository } from "../../repositories/permission-repository";
import { ProfileRepository } from "../../repositories/profile-repository";
import { IntegrationRepository } from "../../repositories/integration-repository";
import { TaskRepository } from "../../repositories/task-repository";
import { TeamRepository } from "../../repositories/team-repository";
import { TeamSupervisionRepository } from "../../repositories/team-supervision-repository";
import { canonicalGreetingName } from "../../domain/profile/greeting";
import { AccountProvisioningService } from "../../services/account-provisioning-service";
import { PermissionService } from "../../services/permission-service";
import { ProfileService } from "../../services/profile-service";
import { IntegrationService } from "../../services/integration-service";
import { AuthAdminAdapter } from "./auth-admin";
import { ActivityService } from "../../services/activity-service";
import { CatalogService } from "../../services/catalog-service";
import { CompanyService } from "../../services/company-service";
import { OrganizationService } from "../../services/organization-service";
import { DashboardService } from "../../services/dashboard-service";
import { CompanyWalletService } from "../../services/company-wallet-service";
import { ContactService } from "../../services/contact-service";
import { CouponService } from "../../services/coupon-service";
import { OrderService } from "../../services/order-service";
import { InvoiceService } from "../../services/invoice-service";
import { SubscriptionService } from "../../services/subscription-service";
import { SubscriptionCalendarService } from "../../services/subscription-calendar-service";
import { FormService } from "../../services/form-service";
import { TicketService } from "../../services/ticket-service";
import { ProjectConversationService } from "../../services/project-conversation-service";
import { WfCardService } from "../../services/wf-card-service";
import { ReportingService } from "../../services/reporting-service";
import { StoreInterestService } from "../../services/store-interest-service";
import { TaskService } from "../../services/task-service";
import { TeamService } from "../../services/team-service";
import { TeamSupervisionService } from "../../services/team-supervision-service";

const internalRoleNames = new Set(["owner", "admin", "manager", "staff"]);

export type TeamCapabilities = {
  view: boolean;
  create: boolean;
  managePermissions: boolean;
};

/**
 * Presentation only, like every other capability block here. The workspace hides
 * its status control without `manage`, and app_set_investment_intent_status
 * refuses the call regardless of what the browser was shown.
 */
export type InvestmentIntentCapabilities = {
  view: boolean;
  manage: boolean;
};

/**
 * Presentation only. The Reporting builder hides Send without it, and
 * app_send_report_draft refuses the call regardless of what the browser saw.
 */
export type ReportingCapabilities = {
  send: boolean;
};

/**
 * Internal staff-to-staff messaging.
 *
 * `use` decides whether the Messages icon appears at all; `manageTasks` decides
 * whether the composer offers Create Task and whether Team Tasks is offered
 * alongside My Tasks. Presentation only, as everywhere else here:
 * private.require_team_actor() and private.require_team_task_manager() refuse
 * the call regardless of what the browser chose to render, and a client account
 * holds neither key.
 */
export type TeamMessagingCapabilities = {
  use: boolean;
  manageTasks: boolean;
};

export type ClientAdministrationCapabilities = {
  view: boolean;
  create: boolean;
  edit: boolean;
  archive: boolean;
  privateManage: boolean;
};

export type ServiceAdministrationCapabilities = {
  view: boolean;
  create: boolean;
  edit: boolean;
  archive: boolean;
};

export type IntegrationAdministrationCapabilities = {
  manage: boolean;
};

export type InternalUser = {
  id: string;
  displayName: string | null;
  greetingName: string | null;
  /**
   * Public avatar URL, or null when the account still falls back to initials.
   * Read from public.profiles on the same query that resolves identity, so the
   * shell never needs a second round trip to render the account avatar.
   */
  avatarUrl: string | null;
  role: "owner" | "admin" | "manager" | "staff";
  /** The database-validated current Tenant of this membership (D-285 gates on it). */
  tenantId: string;
  /**
   * Navigation visibility derived from public.permission_modules, so the rail
   * and the server-side rejection share one boundary. Never a substitute for it:
   * app_require_module_access and every RPC still re-authorize on their own.
   */
  modules: Record<string, boolean>;
  team: TeamCapabilities;
  canManageCoupons: boolean;
  invoices: InvoiceCapabilities;
  subscriptions: SubscriptionCapabilities;
  forms: FormCapabilities;
  tickets: TicketCapabilities;
  projects: ProjectCapabilities;
  clients: ClientAdministrationCapabilities;
  services: ServiceAdministrationCapabilities;
  investmentIntent: InvestmentIntentCapabilities;
  teamMessaging: TeamMessagingCapabilities;
  reporting: ReportingCapabilities;
  integrations: IntegrationAdministrationCapabilities;
};

export type ClientUser = {
  id: string;
  companyId: string;
  displayName: string | null;
  companyName: string;
  /**
   * Portal navigation visibility, from the same public.permission_modules
   * boundary the internal rail uses. app_current_user_modules() returns only
   * the caller's own account class, so a client can never receive an internal
   * module key here. Presentation only: app_require_module_access() and RLS
   * remain authoritative for every screen and every row.
   */
  modules: Record<string, boolean>;
};

export function readLocalFrontendEnvironment() {
  return readPublicEnvironment();
}

export async function createNextServerSupabaseClient() {
  const environment = readLocalFrontendEnvironment();
  const cookieStore = await cookies();

  return createServerClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          // Server Action writes: login, logout and password change. Routed
          // through the shared auth-cookie policy (D-114) so HttpOnly and
          // production Secure hold on every session cookie this app sets.
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, hardenAuthCookieOptions(options)),
          );
        } catch {
          // Server Components cannot write cookies. src/proxy.ts refreshes them first.
        }
      },
    },
  });
}

/**
 * Auth-only SSR client for password sign-in.
 *
 * Supabase Auth accepts `Sb-Forwarded-For` only from a modern secret key. That
 * is the supported way for a server-side framework to keep provider rate
 * limiting keyed on the real visitor instead of Vercel's shared egress IP.
 * The source value has already been validated from Vercel's overwritten
 * `x-vercel-forwarded-for` header by login-protection.ts.
 *
 * This client is used for Auth only. Post-auth application reads still use a
 * user-scoped client created from the returned access token, so the secret key
 * never becomes an authorization shortcut.
 */
export async function createNextServerSignInSupabaseClient(forwardedIp: string | null) {
  if (!forwardedIp) return createNextServerSupabaseClient();

  const environment = readServerEnvironment();
  const cookieStore = await cookies();
  return createServerClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "sb-forwarded-for": forwardedIp } },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, hardenAuthCookieOptions(options)),
          );
        } catch {
          // Login runs as a Server Action, where writes are supported. Keep the
          // same defensive shape as the general SSR client for reuse safety.
        }
      },
    },
  });
}

export async function resolveInternalUser(
  client: UserScopedClient,
  actor: VerifiedActor,
): Promise<InternalUser | null> {
  // Access and role come from the caller's membership in the current Tenant
  // (WL-2.18), never from the global Wolf Forge compatibility profiles.role_id.
  const [membershipResult, profileResult, permissionsResult, modulesResult] = await Promise.all([
    client.rpc("app_current_tenant_membership"),
    client.from("profiles").select("id, display_name, avatar_url, archived_at").eq("id", actor.id).single(),
    client.rpc("app_current_user_permissions"),
    client.rpc("app_current_user_modules"),
  ]);

  const membership = membershipResult.error ? undefined : membershipResult.data?.[0];
  const role = membership?.role_name;
  if (membership?.account_class !== "internal" || !role || !internalRoleNames.has(role)) return null;
  if (profileResult.error || !profileResult.data || profileResult.data.archived_at) return null;

  const granted = new Set(
    permissionsResult.error ? [] : (permissionsResult.data ?? []).map((row) => row.permission_key),
  );

  return {
    id: profileResult.data.id,
    displayName: profileResult.data.display_name,
    greetingName: canonicalGreetingName(profileResult.data.display_name),
    avatarUrl: profileResult.data.avatar_url,
    role: role as InternalUser["role"],
    tenantId: membership.tenant_id,
    modules: toModuleAccessMap(
      modulesResult.error ? [] : ((modulesResult.data ?? []) as ModuleAccess[]),
    ),
    team: {
      view: granted.has("users.view"),
      create: granted.has("users.create"),
      managePermissions: granted.has("users.manage_permissions"),
    },
    canManageCoupons: granted.has("coupons.manage"),
    invoices: {
      view: granted.has("invoices.view"),
      manage: granted.has("invoices.manage"),
      markPaid: granted.has("invoices.mark_paid"),
      void: granted.has("invoices.void"),
      refund: granted.has("invoices.refund"),
    },
    subscriptions: {
      view: granted.has("subscriptions.view"),
      manage: granted.has("subscriptions.manage"),
      pause: granted.has("subscriptions.pause"),
      cancel: granted.has("subscriptions.cancel"),
      billing: granted.has("subscriptions.billing"),
    },
    forms: {
      view: granted.has("forms.view"),
      manage: granted.has("forms.manage"),
      publish: granted.has("forms.publish"),
      assign: granted.has("forms.assign"),
      submissionsView: granted.has("forms.submissions_view"),
      submissionsManage: granted.has("forms.submissions_manage"),
    },
    tickets: {
      view: granted.has("tickets.view"),
      create: granted.has("tickets.create"),
      reply: granted.has("tickets.reply"),
      edit: granted.has("tickets.edit"),
      assign: granted.has("tickets.assign"),
      internalNotes: granted.has("tickets.internal_notes"),
      archive: granted.has("tickets.archive"),
    },
    projects: {
      create: granted.has("projects.create"),
      edit: granted.has("projects.edit"),
      assign: granted.has("projects.assign"),
      archive: granted.has("projects.archive"),
    },
    clients: {
      view: granted.has("clients.view"),
      create: granted.has("clients.create"),
      edit: granted.has("clients.edit"),
      archive: granted.has("clients.archive"),
      privateManage: granted.has("client_private.manage"),
    },
    services: {
      view: granted.has("services.view"),
      create: granted.has("services.create"),
      edit: granted.has("services.edit"),
      archive: granted.has("services.archive"),
    },
    investmentIntent: {
      view: granted.has("investment_intent.view"),
      manage: granted.has("investment_intent.manage"),
    },
    teamMessaging: {
      use: granted.has("team_messages.use"),
      manageTasks: granted.has("team_tasks.manage"),
    },
    reporting: {
      send: granted.has("reports.send"),
    },
    integrations: {
      manage: granted.has("integrations.manage"),
    },
  };
}

export async function resolveClientUser(
  client: UserScopedClient,
  actor: VerifiedActor,
): Promise<ClientUser | null> {
  const [result, modulesResult] = await Promise.all([
    client.rpc("app_get_client_account_context"),
    client.rpc("app_current_user_modules"),
  ]);
  if (result.error) return null;
  const account = result.data?.[0];
  if (!account || account.profile_id !== actor.id) return null;

  return {
    id: account.profile_id,
    companyId: account.company_id,
    displayName: account.display_name,
    companyName: account.company_name,
    modules: toModuleAccessMap(
      modulesResult.error ? [] : ((modulesResult.data ?? []) as ModuleAccess[]),
    ),
  };
}

/**
 * Security C2-4. Records why a context resolver turned a caller away, then lets
 * the caller be redirected exactly as before.
 *
 * The three refusals are deliberately NOT one event. "No session" is what an
 * expired bookmark looks like and happens constantly. "Session present but the
 * token did not verify" is an expired — or forged — JWT. "Verified actor, wrong
 * surface" is a client account reaching into the staff application, which is
 * the one genuinely interesting case and the only one that carries an actor id.
 *
 * Awaited before `redirect()`, which throws, so the event is written first.
 */
async function recordContextRefusal(input: {
  event: "authorization.context.unauthenticated" | "authorization.context.denied" | "auth.session.unverified";
  surface: "internal" | "client" | "self_service";
  actorId?: string | null;
  reason: string;
}): Promise<void> {
  const correlationId = await currentCorrelationId();

  recordSecurityEvent({
    event: input.event,
    correlationId,
    actorId: input.actorId,
    actorClass: input.surface === "self_service" ? "self_service" : input.surface,
    outcome: "denied",
    metadata: { action: "context.resolve", surface: input.surface, reason: input.reason },
  });

  /*
   * Security C2-5. ONLY the cross-surface refusal becomes durable. A verified
   * account reaching for a surface that is not theirs is an access-probe
   * against the platform boundary, it always carries a verified actor id, and
   * it is rare enough to stay investigable. The other two refusals are
   * constant background — expired bookmarks and expired sessions — and would
   * turn the audit trail into noise if every one became a permanent row.
   *
   * Awaited because every caller redirects immediately afterwards, and
   * `redirect()` throws: the row must exist before this function's control
   * flow ends. The writer cannot throw.
   */
  if (input.event === "authorization.context.denied") {
    await recordSecurityAuditEvent({
      event: "authorization.context.denied",
      correlationId,
      actorId: input.actorId ?? null,
      actorClass: input.surface === "self_service" ? "self_service" : input.surface,
      actionSlug: "context.resolve",
      outcome: "denied",
      metadata: { surface: input.surface, reason: input.reason },
    });
  }
}

export const getInternalContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    await recordContextRefusal({
      event: "authorization.context.unauthenticated",
      surface: "internal",
      reason: "no_session",
    });
    redirect("/login");
  }

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) {
    await recordContextRefusal({
      event: "auth.session.unverified",
      surface: "internal",
      reason: "actor_unverified",
    });
    redirect("/login");
  }

  const user = await resolveInternalUser(client, actor);
  if (!user) {
    /*
     * A verified account with no internal role reaching the staff application.
     * This is the cross-surface attempt, and it is the reason this resolver
     * logs at all.
     */
    await recordContextRefusal({
      event: "authorization.context.denied",
      surface: "internal",
      actorId: actor.id,
      reason: "not_internal_actor",
    });
    redirect("/login?reason=staff-only");
  }

  return {
    actor,
    client,
    user,
    services: {
      activity: new ActivityService(new ActivityRepository(client)),
      catalog: new CatalogService({ repository: new ServiceRepository(client) }),
      companies: new CompanyService({ repository: new CompanyRepository(client) }),
      organizations: new OrganizationService({ repository: new OrganizationRepository(client) }),
      dashboard: new DashboardService({ repository: new DashboardRepository(client) }),
      wallets: new CompanyWalletService({ repository: new CompanyWalletRepository(client) }),
      // Internal staff grant and withdraw the WF Card entitlement that unlocks
      // the Wolf Forge Balance rail; the RPC behind it re-checks invoices.manage.
      wfCard: new WfCardService({ repository: new WfCardRepository(client) }),
      contacts: new ContactService({ repository: new ContactRepository(client) }),
      coupons: new CouponService({ repository: new CouponRepository(client) }),
      invoices: new InvoiceService({ repository: new InvoiceRepository(client) }),
      subscriptions: new SubscriptionService({ repository: new SubscriptionRepository(client) }),
      subscriptionCalendar: new SubscriptionCalendarService({
        repository: new SubscriptionRepository(client),
      }),
      forms: new FormService({ repository: new FormRepository(client) }),
      tickets: new TicketService({ repository: new TicketRepository(client) }),
      /**
       * Phase 2 native Project conversation read model (project_messages).
       * Constructed so it is reachable through the canonical services
       * container, but not called from any page or component yet -- the
       * Ticket-backed `tickets.getForOrder` above remains the live path.
       */
      projectConversation: new ProjectConversationService({
        repository: new ProjectConversationRepository(client),
      }),
      orders: new OrderService({ repository: new OrderRepository(client) }),
      tasks: new TaskService({ repository: new TaskRepository(client) }),
      permissions: new PermissionService({ repository: new PermissionRepository(client) }),
      profile: new ProfileService({ repository: new ProfileRepository(client) }),
      integrations: new IntegrationService({
        repository: new IntegrationRepository(client),
      }),
      /**
       * The Investment Intent workspace. Reads and status changes both
       * re-authorize through the internal investment_intent module inside the
       * database, so this service grants nothing by being constructed here.
       */
      investmentIntent: new StoreInterestService({
        repository: new StoreInterestRepository(client),
      }),
      /**
       * Internal staff-to-staff messaging and the team tasks that hang off it.
       * A separate security domain from the client Ticket system: every RPC
       * behind this service requires an internal actor holding
       * team_messages.use, so constructing it grants nothing.
       */
      team: new TeamService({ repository: new TeamRepository(client) }),
      /**
       * Read-only Team supervision. Same user-scoped client: every supervisory
       * RPC derives the supervisor from auth.uid() and requires
       * team_messages.supervise, so constructing this grants nothing.
       */
      teamSupervision: new TeamSupervisionService({
        repository: new TeamSupervisionRepository(client),
      }),
      /**
       * The Reporting builder and the transitional quick send. Every RPC behind
       * it re-checks for an internal actor holding reports.send through the
       * internal reporting module, so constructing this grants nothing.
       */
      reporting: new ReportingService({ repository: new ReportingRepository(client) }),
    },
  };
});

/**
 * The Team synchronization context — a verified actor and the Team service,
 * and deliberately nothing else.
 *
 * getInternalContext() additionally resolves the caller's profile, role,
 * permission keys and module map. Those four queries decide what the SHELL
 * renders; they decide nothing here, because these two routes render no
 * navigation, no capability and no page. Paying for them on every poll and
 * every keystroke put a second wave of database round trips in front of the
 * one read the viewer is actually waiting for, which is invisible on loopback
 * and dominant from a serverless function to a hosted project.
 *
 * Dropping them removes no boundary. private.require_team_actor() inside every
 * Team RPC re-derives the subject from auth.uid() and refuses any account that
 * is not an active internal member holding team_messages.use — a client
 * account included — regardless of what this function did or did not look up.
 *
 * Returns null instead of redirecting: a route handler answers a fetch, and a
 * background poll that has lost its session should receive 401, not a redirect
 * to a login page it cannot render.
 */
export const getTeamActorContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;

  const client = createUserSupabaseClient(
    readLocalFrontendEnvironment(),
    data.session.access_token,
  );
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) return null;

  return {
    actor,
    team: new TeamService({ repository: new TeamRepository(client) }),
  };
});

/**
 * The Ticket live-lane context — a verified actor and the Ticket service, and
 * deliberately nothing else.
 *
 * One context serves BOTH surfaces, because a Ticket conversation is opened by
 * staff and by the client who owns it, and the page render for each already
 * reaches the same `TicketService.get()` -> `app_get_ticket_detail_with_avatars`
 * call through whichever context that route resolved. Resolving the caller's
 * role here would add a query that decides nothing: the RPC re-derives the
 * subject from `auth.uid()` and refuses a Ticket the actor cannot see, and
 * `app_get_ticket_detail` filters internal notes out for a client actor inside
 * Postgres (`actor.role_name <> 'client' or message.visibility = 'client'`).
 * A client therefore cannot receive an internal note through this route even
 * if it asked for one by id.
 *
 * Returns null instead of redirecting: a poll that has lost its session should
 * receive 401, not a redirect to a login page it cannot render.
 */
export const getTicketActorContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;

  const client = createUserSupabaseClient(
    readLocalFrontendEnvironment(),
    data.session.access_token,
  );
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) return null;

  return {
    actor,
    tickets: new TicketService({ repository: new TicketRepository(client) }),
  };
});

/**
 * The internal-actor context for a Route Handler that answers a background
 * fetch rather than rendering a page — the same session, actor-verification
 * AND internal-role checks as getInternalContext(), but returns null instead
 * of redirecting on failure, for the same reason getTeamActorContext() does
 * above: a poll that has lost its session should receive 401, not a redirect
 * to a login page it cannot render.
 *
 * Unlike getTeamActorContext(), this DOES resolve internal-role membership
 * (resolveInternalUser). Team's own routes can skip that because every Team
 * RPC re-derives and re-checks the actor inside Postgres
 * (private.require_team_actor()) regardless of what this function decided.
 * The Podcast SEO sync polling/refetch routes have no equivalent per-actor
 * database recheck — Google Sheets access is a single service-account read
 * with no RLS — so this function IS the only authorization boundary those
 * routes have, and it has to match getInternalContext()'s full check.
 */
export const getInternalActorContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) return null;

  const user = await resolveInternalUser(client, actor);
  if (!user) return null;

  return { actor, user, client };
});

/**
 * Account provisioning needs the server-only Supabase Auth Admin boundary in
 * addition to the session-scoped client, so it is constructed on demand rather
 * than being attached to every internal request.
 */
export async function getAccountProvisioningService() {
  const context = await getInternalContext();

  return {
    context,
    provisioning: new AccountProvisioningService({
      permissions: new PermissionRepository(context.client),
      companies: new CompanyRepository(context.client),
      contacts: new ContactRepository(context.client),
      authAdmin: AuthAdminAdapter.create(),
    }),
  };
}

/**
 * A verified account acting on itself, whatever class it belongs to.
 *
 * Self-service profile operations — display name, avatar, password — are the
 * one surface an internal member and a client account share. The underlying
 * RPCs (app_get_my_profile, app_update_my_profile, app_set_my_avatar,
 * app_clear_my_avatar) are granted to `authenticated`, take no profile id and
 * derive the account from auth.uid(), so there is no parameter that could be
 * pointed at somebody else's row and nothing here to scope by company.
 *
 * This exists so a client can reach those RPCs without getInternalContext()
 * turning them away for not being staff. It grants nothing: it resolves the
 * session, verifies the actor, and hands back a ProfileService bound to that
 * session's client. No role check is skipped, because no role check applies —
 * the only authority for these calls is auth.uid(), and it always has been.
 */
export const getSelfServiceContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    await recordContextRefusal({
      event: "authorization.context.unauthenticated",
      surface: "self_service",
      reason: "no_session",
    });
    redirect("/login");
  }

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) {
    await recordContextRefusal({
      event: "auth.session.unverified",
      surface: "self_service",
      reason: "actor_unverified",
    });
    redirect("/login");
  }

  return {
    actor,
    client,
    services: {
      profile: new ProfileService({ repository: new ProfileRepository(client) }),
    },
  };
});

export const getClientContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    await recordContextRefusal({
      event: "authorization.context.unauthenticated",
      surface: "client",
      reason: "no_session",
    });
    redirect("/login?next=/account");
  }

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) {
    await recordContextRefusal({
      event: "auth.session.unverified",
      surface: "client",
      reason: "actor_unverified",
    });
    redirect("/login?next=/account");
  }

  const user = await resolveClientUser(client, actor);
  if (!user) {
    await recordContextRefusal({
      event: "authorization.context.denied",
      surface: "client",
      actorId: actor.id,
      reason: "no_client_assignment",
    });
    redirect("/login?reason=client-only");
  }

  return {
    actor,
    client,
    user,
    services: {
      invoices: new InvoiceService({ repository: new InvoiceRepository(client) }),
      subscriptions: new SubscriptionService({ repository: new SubscriptionRepository(client) }),
      subscriptionCalendar: new SubscriptionCalendarService({
        repository: new SubscriptionRepository(client),
      }),
      forms: new FormService({ repository: new FormRepository(client) }),
      tickets: new TicketService({ repository: new TicketRepository(client) }),
      /**
       * Phase 2 native Project conversation read model, same authorization
       * boundary as `tickets.getForOrder` above (require_order_conversation_access
       * already supports the client role). Not called from any client page yet.
       */
      projectConversation: new ProjectConversationService({
        repository: new ProjectConversationRepository(client),
      }),
      wallets: new CompanyWalletService({ repository: new CompanyWalletRepository(client) }),
      wfCard: new WfCardService({ repository: new WfCardRepository(client) }),
      permissions: new PermissionService({ repository: new PermissionRepository(client) }),
      /**
       * Self-service only. Every ProfileRepository call is an RPC that takes no
       * profile id and derives the account from auth.uid(), so this cannot read
       * or write anyone but the caller — including anyone else at the same
       * company.
       */
      profile: new ProfileService({ repository: new ProfileRepository(client) }),
      /**
       * Store and Projects run on the same session-scoped client as everything
       * else here. Both are read-only in the portal: catalog visibility comes
       * from the services RLS policies, while caller-scoped Project RPCs expose
       * only the safe portal DTO. No service-role client is ever constructed on
       * this path.
       */
      catalog: new CatalogService({ repository: new ServiceRepository(client) }),
      projects: new OrderService({ repository: new OrderRepository(client) }),
      /**
       * Write-only from the portal's point of view: the only method a client
       * path reaches is record(), and no client-facing read of interest exists.
       * The company is derived from auth.uid() inside the RPC, so this cannot
       * record interest for anyone but the caller's own company.
       */
      storeInterest: new StoreInterestService({
        repository: new StoreInterestRepository(client),
      }),
      /**
       * Read and mark-read only. Every reporting RPC a client can reach derives
       * the company from auth.uid(), so this cannot see another company's
       * reports whatever the caller passes.
       */
      reporting: new ReportingService({ repository: new ReportingRepository(client) }),
    },
  };
});
