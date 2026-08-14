import Link from "next/link";
import { PageFrame } from "../../../../components/ui/page-frame";

export default function InvoiceNotFound() {
  return <PageFrame title="Invoice not found"><div className="error-state"><strong>This invoice is unavailable.</strong><span>It may have been removed or your access may have changed.</span><Link className="button-secondary" href="/invoices">Back to Invoices</Link></div></PageFrame>;
}
