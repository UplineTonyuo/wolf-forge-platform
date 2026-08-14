import Link from "next/link";
import { PageFrame } from "../../../components/ui/page-frame";

export default function CouponsForbidden() {
  return (
    <PageFrame title="Coupons">
      <section className="error-state">
        <strong>Coupons access denied.</strong>
        <span>You need the coupons.manage capability to use Coupons administration.</span>
        <div className="error-retry"><Link className="button-secondary" href="/">Return to Wolf Forge</Link></div>
      </section>
    </PageFrame>
  );
}
