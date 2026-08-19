"use client";

import { Printer } from "lucide-react";

/**
 * Print / save as PDF.
 *
 * Deliberately the browser's own print pipeline rather than a generated
 * document: nothing is uploaded, no rendering service is involved, and the page
 * the client saves is exactly the page they were shown. The portal print styles
 * in globals.css drop the rail and the actions so the sheet is just the invoice.
 */
export function PrintInvoiceButton() {
  return (
    <button type="button" className="portal-ghost-action" onClick={() => window.print()}>
      <Printer aria-hidden={true} />
      Print or save as PDF
    </button>
  );
}
