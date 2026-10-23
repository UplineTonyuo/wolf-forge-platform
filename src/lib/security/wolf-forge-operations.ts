import "server-only";

import { notFound } from "next/navigation";
import { isWolfForgeTenant } from "../../domain/tenancy/wolf-forge-tenant";
import { getInternalContext } from "../supabase/next-server";

/**
 * Operations department workflows (Podcast SEO, Content, On-Page / Off-Page /
 * Technical / YouTube SEO, GMB, Website Builder) read one Wolf Forge Google
 * Sheet integration through a cache shared by every request. They stay Wolf
 * Forge-only until per-Tenant integrations exist (D-285, D-270): an internal
 * member of any other Tenant gets a 404 BEFORE any Sheets fetch or cache read.
 *
 * Await this first in every department page. The API routes use
 * `isWolfForgeTenant(context.user.tenantId)` directly.
 */
export async function requireWolfForgeOperations() {
  const context = await getInternalContext();
  if (!isWolfForgeTenant(context.user.tenantId)) notFound();
  return context;
}
