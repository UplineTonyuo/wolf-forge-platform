import { Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveCouponButton } from "../../../components/coupons/archive-coupon-button";
import { CouponsFilter } from "../../../components/coupons/coupons-filter";
import adminList from "../../../components/ui/admin-list.module.css";
import { FilterInput } from "../../../components/ui/filter-input";
import { EmptyState } from "../../../components/ui/list-states";
import { ListToolbar } from "../../../components/ui/list-toolbar";
import { PageFrame } from "../../../components/ui/page-frame";
import { SuccessToast } from "../../../components/ui/success-toast";
import { formatDate, formatDateTime } from "../../../lib/format";
import { getInternalContext } from "../../../lib/supabase/next-server";
import styles from "../../../components/coupons/coupon-admin.module.css";

export const metadata: Metadata = { title: "Coupons" };

/** Preserves the caller's other query values while switching the status view. */
function couponHref(view: "active" | "archived", search: string) {
  const params = new URLSearchParams();
  if (view === "archived") params.set("view", "archived");
  if (search) params.set("q", search);
  const query = params.toString();
  return query ? `/coupons?${query}` : "/coupons";
}

export default async function CouponsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; created?: string; archived?: string; q?: string }>;
}) {
  const query = await searchParams;
  const showingArchived = query.view === "archived";
  const search = query.q?.trim() ?? "";
  const context = await getInternalContext();
  const coupons = await context.services.coupons.list(showingArchived);

  /*
   * Text search narrows what is already on screen. The Active/Archived split
   * above still decides which set is loaded, so status filtering is unchanged.
   */
  const needle = search.toLocaleLowerCase();
  const visible = needle
    ? coupons.filter((coupon) =>
        coupon.code.toLocaleLowerCase().includes(needle) ||
        (coupon.description ?? "").toLocaleLowerCase().includes(needle))
    : coupons;

  const addCoupon = (
    <Link className={`button-primary ${adminList.actionButton}`} href="/coupons/new">
      <Plus aria-hidden="true" />Add Coupon
    </Link>
  );

  /*
   * The empty state keeps its own copy of the same link -- there it is the
   * point of the screen, not a duplicate of the title action.
   */
  const addCouponToolbar = (
    <div className={styles.desktopAction}>{addCoupon}</div>
  );

  const addCouponCompact = (
    <Link
      className={styles.compactAction}
      href="/coupons/new"
      aria-label="Add coupon"
      title="Add coupon"
    >
      <Plus aria-hidden="true" />
    </Link>
  );

  return (
    <PageFrame
      title="Coupons"
      action={
        <div className="page-action-compact mobile-page-action">
          {addCouponCompact}
        </div>
      }
    >
      {query.created ? (
        <SuccessToast title="Coupon created" detail="It is now listed under Active." />
      ) : null}
      {query.archived ? (
        <SuccessToast title="Coupon archived" detail="Redemption history was preserved." />
      ) : null}

      <ListToolbar
        label="Coupon status filters"
        filters={[
          { value: "active", label: "Active", href: couponHref("active", search), active: !showingArchived },
          { value: "archived", label: "Archived", href: couponHref("archived", search), active: showingArchived },
        ]}
        action={addCouponToolbar}
        search={<FilterInput label="Search coupons" placeholder="Search coupons" initialValue={search} />}
        filter={<CouponsFilter initialView={showingArchived ? "archived" : "active"} />}
        filtersDesktopOnly
      />

      {visible.length === 0 ? (
        <EmptyState
          title={search ? "No matching coupons" : showingArchived ? "No archived coupons" : "No coupons yet"}
          body={
            search
              ? `Nothing matches “${search}” in ${showingArchived ? "archived" : "active"} coupons.`
              : showingArchived
                ? "Coupons you archive are kept here with their redemption history."
                : "Create discount codes for your Services."
          }
          action={showingArchived || search ? undefined : addCoupon}
        />
      ) : (
        <>
          <div className={`desktop-table-wrap ${styles.tableWrap}`}>
            <table className={`${styles.table} ${adminList.table}`}>
              <colgroup>
                <col className={styles.codeColumn} /><col className={styles.descriptionColumn} />
                <col /><col className={styles.expiryColumn} /><col /><col /><col /><col /><col className={styles.actionsColumn} />
              </colgroup>
              <thead><tr>
                <th>Code</th><th>Description</th><th>Type</th><th>Expires</th><th>Single use</th>
                <th>Times used</th><th>Created</th><th>Updated</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {visible.map((coupon) => (
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
            {visible.map((coupon) => (
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
