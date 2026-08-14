import Link from "next/link";

export default function ClientSubscriptionNotFound() {
  return <div className="error-state"><strong>Subscription unavailable.</strong><span>This Subscription does not belong to your company or no longer exists.</span><Link className="button-secondary" href="/account/subscriptions">Back to Subscriptions</Link></div>;
}
