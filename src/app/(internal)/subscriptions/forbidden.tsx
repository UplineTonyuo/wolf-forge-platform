import Link from "next/link";
import { PageFrame } from "../../../components/ui/page-frame";

export default function SubscriptionsForbidden() {
  return <PageFrame title="Subscriptions"><div className="error-state" role="alert"><strong>Subscription access is restricted.</strong><span>This operation requires the appropriate role and enabled Subscriptions.</span><Link className="button-secondary" href="/">Return to workspace</Link></div></PageFrame>;
}
