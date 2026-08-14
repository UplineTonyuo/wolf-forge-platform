import Link from "next/link";
import { PageFrame } from "../../../../components/ui/page-frame";

export default function ServiceNotFound() {
  return <PageFrame title="Service unavailable"><div className="error-state"><strong>This service does not exist or was soft deleted.</strong><Link href="/services">Back to Services</Link></div></PageFrame>;
}
