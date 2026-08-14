import Link from "next/link";
import { PageFrame } from "../../../../components/ui/page-frame";

export default function ProjectNotFound() {
  return (
    <PageFrame title="Project unavailable">
      <div className="error-state">
        <strong>This project no longer exists, was archived, or is outside your access.</strong>
        <Link href="/orders">Back to projects</Link>
      </div>
    </PageFrame>
  );
}
