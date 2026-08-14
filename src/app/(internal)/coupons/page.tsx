import { Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveCouponButton } from "../../../components/coupons/archive-coupon-button";
import { EmptyState } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { formatDate, formatDateTime } from "../../../lib/format";
import { getInternalContext } from "../../../lib/supabase/next-server";
import styles from "../../../components/coupons/coupon-admin.module.css";

export const metadata: Metadata = { title: "Coupons" };

export default async function CouponsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; created?: string; archived?: string }>;
}) {
  const query = await searchParams;
  const showingArchived = query.view === "archived";
  const context = await getInternalContext();
  const coupons = await context.services.coupons.list(showingArchived);

  return (
    <PageFrame
      title="Coupons"
      action={<Link className="button-primary" href="/coupons/new"><Plus aria-hidden="true" />Add Coupon</Link>}
    >
      {query.created ? <div className="success-banner">Coupon created.</div> : null}
      {query.archived ? <div className="success-banner">Coupon archived. Redemption history was preserved.</div> : null}

      <nav className={styles.viewTabs} aria-label="Coupon status">
        <Link className={!showingArchived ? styles.activeTab : undefined} href="/coupons">Active</Link>
        <Link className={showingArchived ? styles.activeTab : undefined} href="/coupons?view=archived">Archived</Link>
      </nav>

      {coupons.length === 0 ? (
        <EmptyState
          title="Coupons"
          body={showingArchived ? "No archived coupons." : "Create discount codes for your Services."}
          action={showingArchived ? undefined : <Link className="button-primary" href="/coupons/new"><Plus aria-hidden="true" />Add Coupon</Link>}
        />
      ) : (
        <>
          <div className={`desktop-table-wrap ${styles.tableWrap}`}>
            <table className={styles.table}>
              <colgroup>
                <col className={styles.codeColumn} /><col className={styles.descriptionColumn} />
                <col /><col className={styles.expiryColumn} /><col /><col /><col /><col /><col className={styles.actionsColumn} />
              </colgroup>
              <thead><tr>
                <th>Code</th><th>Description</th><th>Type</th><th>Expires</th><th>Single use</th>
                <th>Times used</th><th>Created</th><th>Updated</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {coupons.map((coupon) => (
                  <tr key={coupon.id}>
                    <td><strong className={styles.code}>{coupon.code}</strong>{!coupon.is_active && !showingArchived ? <span className={styles.inactive}>Inactive</span> : null}</td>
                    <td><span className={styles.description} title={coupon.description ?? undefined}>{coupon.description ?? "—"}</span></td>
                    <td>{coupon.discount_type === "fixed" ? "Fixed amount" : "Percentage"}</td>
                    <td>{coupon.expires_at ? formatDateTime(coupon.expires_at) : "No expiry"}</td>
                    <td>{coupon.single_use_per_customer ? "Yes" : "No"}</td>
                    <td>{coupon.usageCount}</td>
                    <td>{formatDate(coupon.created_at)}</td>
                    <td>{formatDate(coupon.updated_at)}</td>
                    <td>
                      {showingArchived ? <span className={styles.archivedLabel}>Archived</span> : (
                        <div className={styles.rowActions}>
                          <Link href={`/coupons/${coupon.id}`}><Pencil aria-hidden="true" />Edit</Link>
                          <ArchiveCouponButton couponId={coupon.id} code={coupon.code} compact />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`mobile-record-list ${styles.mobileList}`}>
            {coupons.map((coupon) => (
              <article className={styles.mobileCard} key={coupon.id}>
                <div className={styles.mobileCardHeading}>
                  <div><strong>{coupon.code}</strong><span>{coupon.description ?? "No description"}</span></div>
                  <span className={styles.typeLabel}>{coupon.discount_type === "fixed" ? "Fixed amount" : "Percentage"}</span>
                </div>
                <dl>
                  <div><dt>Expires</dt><dd>{coupon.expires_at ? formatDateTime(coupon.expires_at) : "No expiry"}</dd></div>
                  <div><dt>Single use</dt><dd>{coupon.single_use_per_customer ? "Yes" : "No"}</dd></div>
                  <div><dt>Times used</dt><dd>{coupon.usageCount}</dd></div>
                  <div><dt>Updated</dt><dd>{formatDate(coupon.updated_at)}</dd></div>
                </dl>
                {!showingArchived ? <div className={styles.mobileActions}><Link className="button-secondary" href={`/coupons/${coupon.id}`}><Pencil aria-hidden="true" />Edit</Link><ArchiveCouponButton couponId={coupon.id} code={coupon.code} /></div> : null}
              </article>
            ))}
          </div>
        </>
      )}
    </PageFrame>
  );
}
