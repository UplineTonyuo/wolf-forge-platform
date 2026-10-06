import Link from "next/link";
import { PageFrame } from "../../../../components/ui/page-frame";

export default function CompanyNotFound() {
  return <PageFrame title="Company unavailable"><div className="error-state"><strong>This Company no longer exists or was archived.</strong><Link href="/companies">Back to Companies</Link></div></PageFrame>;
}
