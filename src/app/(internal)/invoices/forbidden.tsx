import Link from "next/link";
import { PageFrame } from "../../../components/ui/page-frame";

export default function InvoicesForbidden() {
  return <PageFrame title="Invoices"><div className="error-state" role="alert"><strong>Invoice access is restricted.</strong><span>Your role does not include invoice administration.</span><Link className="button-secondary" href="/">Return to workspace</Link></div></PageFrame>;
}
