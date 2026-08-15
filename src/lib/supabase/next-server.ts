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
import { createUserSupabaseClient, verifyActor, type UserScopedClient, type VerifiedActor } from "./user-client";
import { ActivityRepository } from "../../repositories/activity-repository";
import { CompanyRepository } from "../../repositories/company-repository";
import { CompanyWalletRepository } from "../../repositories/company-wallet-repository";
import { ContactRepository } from "../../repositories/contact-repository";
import { CouponRepository } from "../../repositories/coupon-repository";
import { OrderRepository } from "../../repositories/order-repository";
import { InvoiceRepository } from "../../repositories/invoice-repository";
import { WfCardRepository } from "../../repositories/wf-card-repository";
import { ServiceRepository } from "../../repositories/service-repository";
import { SubscriptionRepository } from "../../repositories/subscription-repository";
import { FormRepository } from "../../repositories/form-repository";
import { TicketRepository } from "../../repositories/ticket-repository";
import { PermissionRepository } from "../../repositories/permission-repository";
import { TaskRepository } from "../../repositories/task-repository";
import { AccountProvisioningService } from "../../services/account-provisioning-service";
import { PermissionService } from "../../services/permission-service";
import { AuthAdminAdapter } from "./auth-admin";
import { ActivityService } from "../../services/activity-service";
import { CatalogService } from "../../services/catalog-service";
import { CompanyService } from "../../services/company-service";
import { CompanyWalletService } from "../../services/company-wallet-service";
import { ContactService } from "../../services/contact-service";
import { CouponService } from "../../services/coupon-service";
import { OrderService } from "../../services/order-service";
import { InvoiceService } from "../../services/invoice-service";
import { SubscriptionService } from "../../services/subscription-service";
import { FormService } from "../../services/form-service";
import { TicketService } from "../../services/ticket-service";
import { WfCardService } from "../../services/wf-card-service";
import { TaskService } from "../../services/task-service";

const internalRoleNames = new Set(["owner", "admin", "manager", "staff"]);

export type TeamCapabilities = {
  view: boolean;
  create: boolean;
  managePermissions: boolean;
};

export type InternalUser = {
  id: string;
  displayName: string | null;
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
};

export type ClientUser = {
  id: string;
  companyId: string;
  displayName: string | null;
  companyName: string;
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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
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
    client.from("profiles").select("id, role_id, display_name, archived_at").eq("id", actor.id).single(),
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
  };
}

export async function resolveClientUser(
  client: UserScopedClient,
  actor: VerifiedActor,
): Promise<ClientUser | null> {
  const result = await client.rpc("app_get_client_account_context");
  if (result.error) return null;
  const account = result.data?.[0];
  if (!account || account.profile_id !== actor.id) return null;

  return {
    id: account.profile_id,
    companyId: account.company_id,
    displayName: account.display_name,
    companyName: account.company_name,
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
      wallets: new CompanyWalletService({ repository: new CompanyWalletRepository(client) }),
      contacts: new ContactService({ repository: new ContactRepository(client) }),
      coupons: new CouponService({ repository: new CouponRepository(client) }),
      invoices: new InvoiceService({ repository: new InvoiceRepository(client) }),
      subscriptions: new SubscriptionService({ repository: new SubscriptionRepository(client) }),
      forms: new FormService({ repository: new FormRepository(client) }),
      tickets: new TicketService({ repository: new TicketRepository(client) }),
      orders: new OrderService({ repository: new OrderRepository(client) }),
      tasks: new TaskService({ repository: new TaskRepository(client) }),
      permissions: new PermissionService({ repository: new PermissionRepository(client) }),
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

export const getClientContext = cache(async () => {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) redirect("/login?next=/account/invoices");

  const environment = readLocalFrontendEnvironment();
  const client = createUserSupabaseClient(environment, data.session.access_token);
  const actor = await verifyActor(client).catch(() => null);
  if (!actor) redirect("/login?next=/account/invoices");

  const user = await resolveClientUser(client, actor);
  if (!user) redirect("/login?reason=client-only");

  return {
    actor,
    client,
    user,
    services: {
      invoices: new InvoiceService({ repository: new InvoiceRepository(client) }),
      subscriptions: new SubscriptionService({ repository: new SubscriptionRepository(client) }),
      forms: new FormService({ repository: new FormRepository(client) }),
      tickets: new TicketService({ repository: new TicketRepository(client) }),
      wallets: new CompanyWalletService({ repository: new CompanyWalletRepository(client) }),
      wfCard: new WfCardService({ repository: new WfCardRepository(client) }),
      permissions: new PermissionService({ repository: new PermissionRepository(client) }),
    },
  };
});

