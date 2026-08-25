import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readPublicEnvironment } from "../env/public-env";
import type { ProjectCapabilities } from "../../domain/orders/projections";
import type { InvoiceCapabilities } from "../../domain/invoices/schema";
import type { SubscriptionCapabilities } from "../../domain/subscriptions/schema";
import type { FormCapabilities } from "../../domain/forms/schema";
import type { TicketCapabilities } from "../../domain/tickets/schema";
import { toModuleAccessMap, type ModuleAccess } from "../../domain/permissions/schema";
import type { Database } from "./database.types";
import { hardenAuthCookieOptions } from "./auth-cookie-options";
import { createUserSupabaseClient, verifyActor, type UserScopedClient, type VerifiedActor } from "./user-client";
import { ActivityRepository } from "../../repositories/activity-repository";
import { CompanyRepository } from "../../repositories/company-repository";
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
import { PermissionRepository } from "../../repositories/permission-repository";
import { ProfileRepository } from "../../repositories/profile-repository";
import { IntegrationRepository } from "../../repositories/integration-repository";
import { TaskRepository } from "../../repositories/task-repository";
import { AccountProvisioningService } from "../../services/account-provisioning-service";
import { PermissionService } from "../../services/permission-service";
import { ProfileService } from "../../services/profile-service";
import { IntegrationService } from "../../services/integration-service";
import { AuthAdminAdapter } from "./auth-admin";
import { ActivityService } from "../../services/activity-service";
import { CatalogService } from "../../services/catalog-service";
import { CompanyService } from "../../services/company-service";
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
import { WfCardService } from "../../services/wf-card-service";
import { ReportingService } from "../../services/reporting-service";
import { StoreInterestService } from "../../services/store-interest-service";
import { TaskService } from "../../services/task-service";

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
  /**
   * Public avatar URL, or null when the account still falls back to initials.
   * Read from public.profiles on the same query that resolves identity, so the
   * shell never needs a second round trip to render the account avatar.
   */
  avatarUrl: string | null;
  role: "owner" | "admin" | "manager" | "staff";
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

export async function resolveInternalUser(
  client: UserScopedClient,
  actor: VerifiedActor,
): Promise<InternalUser | null> {
  const [profileResult, rolesResult, permissionsResult, modulesResult] = await Promise.all([
    client.from("profiles").select("id, role_id, display_name, avatar_url, archived_at").eq("id", actor.id).single(),
    client.from("roles").select("id, name"),
    client.rpc("app_current_user_permissions"),
    client.rpc("app_current_user_modules"),
  ]);

  if (profileResult.error || !profileResult.data || profileResult.data.archived_at) return null;
  const role = rolesResult.data?.find((candidate) => candidate.id === profileResult.data.role_id)?.name;
  if (!role || !internalRoleNames.has(role)) return null;

  const granted = new Set(
    permissionsResult.error ? [] : (permissionsResult.data ?? []).map((row) => row.permission_key),
  );

  return {
    id: profileResult.data.id,
    displayName: profileResult.data.display_name,
    avatarUrl: profileResult.data.avatar_url,
    role: role as InternalUser["role"],
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

export const getInternalContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) redirect("/login");

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) redirect("/login");

  const user = await resolveInternalUser(client, actor);
  if (!user) redirect("/login?reason=staff-only");

  return {
    actor,
    client,
    user,
    services: {
      activity: new ActivityService(new ActivityRepository(client)),
      catalog: new CatalogService({ repository: new ServiceRepository(client) }),
      companies: new CompanyService({ repository: new CompanyRepository(client) }),
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
       * The Reporting builder and the transitional quick send. Every RPC behind
       * it re-checks for an internal actor holding reports.send through the
       * internal reporting module, so constructing this grants nothing.
       */
      reporting: new ReportingService({ repository: new ReportingRepository(client) }),
    },
  };
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
  if (error || !data.session) redirect("/login");

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) redirect("/login");

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
  if (error || !data.session) redirect("/login?next=/account");

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) redirect("/login?next=/account");

  const user = await resolveClientUser(client, actor);
  if (!user) redirect("/login?reason=client-only");

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
