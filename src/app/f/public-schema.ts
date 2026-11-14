import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache, updateTag } from "next/cache";
import { z } from "zod";
import { formCanonicalKeySchema, formFieldTypes, formRuleSchema, formTypes, type FormPublishedSchema } from "../../domain/forms/schema";
import { uuidSchema } from "../../domain/shared";
import { toTenantSelector } from "../../domain/tenancy/tenant-selector";
import { readServerEnvironment } from "../../lib/env/server-env";
import { DatabaseError, NotFoundError } from "../../lib/errors/application-error";
import { mapDatabaseError } from "../../lib/errors/map-database-error";
import type { Database, Json } from "../../lib/supabase/database.types";
import { requestTenantSelector } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";

const jsonObject = z.record(z.string(), z.json());
const publicPublishedSchema = z.object({
  form_id: uuidSchema,
  form_type: z.enum(formTypes),
  canonical_key: z.string(),
  form_version_id: uuidSchema,
  version_number: z.number().int().positive(),
  schema_hash: z.string().nullable(),
  title: z.string(),
  information_html: z.string().nullable(),
  visibility: z.literal("public"),
  type_config: jsonObject,
  fields: z.array(z.object({
    stable_field_key: uuidSchema,
    sort_order: z.number().int().nonnegative(),
    field_type: z.enum(formFieldTypes),
    label: z.string(),
    placeholder: z.string().nullable(),
    help_html: z.string().nullable(),
    default_value: z.json().nullable(),
    required: z.boolean(),
    settings: jsonObject,
    encrypted_collection_allowed: z.boolean().optional(),
    options: z.array(z.object({
      option_id: uuidSchema,
      value: z.string(),
      label: z.string(),
      sort_order: z.number().int().nonnegative(),
      metadata: jsonObject,
    }).strict()),
    services: z.array(z.object({
      service_id: uuidSchema,
      role: z.enum(["offered_item", "default_item", "intake_assignment"]),
      sort_order: z.number().int().nonnegative(),
      configuration: jsonObject,
      name: z.string(),
      currency: z.string(),
      price_cents: z.number().nonnegative(),
    }).strict()),
  }).strict()),
  rules: z.array(formRuleSchema),
}).strict() satisfies z.ZodType<FormPublishedSchema>;

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
    const schema = publicPublishedSchema.safeParse(data);
    if (!schema.success || schema.data.canonical_key !== key) throw new DatabaseError();
    return schema.data;
  }, ["public-form-schema-v1", tenant, key], { revalidate: 300, tags: [tenantTag(tenant)] })();
}

export async function getRequestPublicPublishedSchema(canonicalKey: string): Promise<FormPublishedSchema> {
  return getPublicPublishedSchema(await requestTenantSelector(), canonicalKey);
}
