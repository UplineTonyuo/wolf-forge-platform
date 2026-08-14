import Link from "next/link";
import { PageFrame } from "../../../../../components/ui/page-frame";

export default function ServiceFolderNotFound() {
  return <PageFrame title="Folder unavailable"><div className="error-state"><strong>This folder does not exist or was soft deleted.</strong><Link href="/services">Back to Services</Link></div></PageFrame>;
}
