import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache, updateTag } from "next/cache";
import { formCanonicalKeySchema, type FormPublishedSchema } from "../../domain/forms/schema";
import { toTenantSelector } from "../../domain/tenancy/tenant-selector";
import { readServerEnvironment } from "../../lib/env/server-env";
import { DatabaseError, NotFoundError } from "../../lib/errors/application-error";
import { mapDatabaseError } from "../../lib/errors/map-database-error";
import type { Database, Json } from "../../lib/supabase/database.types";
import { requestTenantSelector } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";

// Keep the additive RPC typed here until the next full database type generation.
type PublicFormDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      app_get_public_form_schema: {
        Args: { p_tenant_id: string; p_canonical_key: string };
        Returns: Json;
      };
    };
  };
};

const tenantTag = (tenantId: string) => `public-forms:${toTenantSelector(tenantId)}`;

export function invalidatePublicFormSchemas(tenantId: string): void {
  updateTag(tenantTag(tenantId));
}

export async function getPublicPublishedSchema(tenantId: string, canonicalKey: string): Promise<FormPublishedSchema> {
  const tenant = toTenantSelector(tenantId);
  const parsed = formCanonicalKeySchema.safeParse(canonicalKey);
  if (!parsed.success) throw new NotFoundError("Published Form");
  const key = parsed.data;
  return unstable_cache(async () => {
    const client = createTrustedServerSupabaseClient(readServerEnvironment()) as SupabaseClient<PublicFormDatabase>;
    const { data, error } = await client.rpc("app_get_public_form_schema", {
      p_tenant_id: tenant,
      p_canonical_key: key,
    });
    if (error) throw mapDatabaseError(error, "Published Form");
    if (!data) throw new NotFoundError("Published Form");
    const schema = data as unknown as FormPublishedSchema;
    if (schema.visibility !== "public" || schema.canonical_key !== key || !schema.form_id || !schema.form_version_id
      || !Array.isArray(schema.fields) || !Array.isArray(schema.rules)) throw new DatabaseError();
    return schema;
  }, ["public-form-schema-v1", tenant, key], { revalidate: 300, tags: [tenantTag(tenant)] })();
}

export async function getRequestPublicPublishedSchema(canonicalKey: string): Promise<FormPublishedSchema> {
  return getPublicPublishedSchema(await requestTenantSelector(), canonicalKey);
}
