import Link from "next/link";
import { PageFrame } from "../../../../components/ui/page-frame";

export default function ClientNotFound() {
  return <PageFrame title="Client unavailable"><div className="error-state"><strong>This client no longer exists or was archived.</strong><Link href="/clients">Back to clients</Link></div></PageFrame>;
}
