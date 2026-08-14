import Link from "next/link";
import { PageFrame } from "../../../../components/ui/page-frame";

export default function SubscriptionNotFound() {
  return <PageFrame title="Subscription unavailable"><div className="error-state"><strong>This Subscription is unavailable.</strong><span>It may not exist or your access may have changed.</span><Link className="button-secondary" href="/subscriptions">Back to Subscriptions</Link></div></PageFrame>;
}
