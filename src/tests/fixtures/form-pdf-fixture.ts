import type { FormPdfReceipt } from "../../lib/forms/pdf-receipt";

export function receiptFixture(): FormPdfReceipt {
  const name = "10000000-0000-4000-8000-000000000001", signature = "10000000-0000-4000-8000-000000000002";
  return { original: { id: "20000000-0000-4000-8000-000000000001", submitted_at: "2026-10-27T06:30:00+00:00", revision_number: 1, values: [
    { stable_field_key: name, label: "Business name", field_type: "text", sort_order: 0, value: "Synthetic Nguyễn QA & Company" },
    { stable_field_key: signature, label: "Client signature", field_type: "signature", sort_order: 1, value: { name: "Synthetic Signer", consent: true, signed_at: "2026-10-27T06:30:00+00:00", method: "drawn", statement: "I agree to use this drawn signature as my electronic signature for this form.", drawing: [[[30,100],[170,40],[250,230],[700,120],[920,180]]] } },
  ] }, correction: null, form: { id: "30000000-0000-4000-8000-000000000001", version_id: "40000000-0000-4000-8000-000000000001", version_number: 1, schema_hash: "synthetic-version-fingerprint", title: "Synthetic SEO onboarding", information_html: "<p>Synthetic QA only. No customer information.</p>", fields: [
    { key: name, label: "Business name", type: "text", sort_order: 0, help_html: null, html: null, conditional: false, display_only: false, options: [] },
    { key: signature, label: "SEO Services Agreement", type: "signature", sort_order: 1, help_html: "<h2>SEO Services Agreement</h2><p>Agency provides SEO services. Client supplies required access.</p><p>Performance: Specific search rankings are not guaranteed.</p><p>Confidentiality: Both parties protect proprietary information.</p><p>No Refund Policy: See the Agency website.</p>", html: null, conditional: false, display_only: false, options: [] },
  ] }, files: [] };
}
