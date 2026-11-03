import type { SupabaseClient } from "@supabase/supabase-js";
import { invoiceShareTokenSchema, publicInvoiceShareSchema } from "../domain/invoices/manual-payments";
import { parseInput } from "../domain/shared";
import type { Database } from "../lib/supabase/database.types";
import { unwrapOne } from "../lib/supabase/repository-helpers";

/** Public capability reader only; it cannot supply a user-mutation repository. */
export async function readPublicInvoiceShare(client: Pick<SupabaseClient<Database>, "rpc">, token: unknown) {
  const result = await client.rpc("app_get_public_invoice_share", { p_token: parseInput(invoiceShareTokenSchema, token) });
  return publicInvoiceShareSchema.parse(unwrapOne(result, "Invoice"));
}
