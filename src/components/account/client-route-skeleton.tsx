import { portalTitleForPath } from "./portal-nav-registry";
import styles from "./client-route-skeleton.module.css";

export function ClientRouteSkeleton({ pathname }: { pathname: string }) {
  const path = (pathname.split(/[?#]/)[0] ?? "/account").replace(/\/+$/, "") || "/account";
  const title = portalTitleForPath(path);
  const cards = path === "/account" || path.startsWith("/account/store") || path === "/account/reporting";
  const fields = path === "/account/profile" || path === "/account/payment-method" || path.startsWith("/account/onboarding/");

  return (
    <div className={`portal-page ${styles.skeleton}`} role="status" aria-label={`Loading ${title}`} data-client-skeleton={path}>
      <span className="sr-only">Loading {title}</span>
      <div aria-hidden="true" className={styles.body}>
        <header className="portal-page-head">
          <h1>{title}</h1>
          <span className={`internal-page-skeleton-bar ${styles.subtitle}`} />
        </header>
        {cards ? (
          <div className={styles.cards}>
            {Array.from({ length: 3 }, (_, index) => (
              <div className={`route-skeleton-panel ${styles.card}`} key={index}>
                <span className={`internal-page-skeleton-bar ${styles.short}`} />
                <span className={`internal-page-skeleton-bar ${styles.value}`} />
                <span className="internal-page-skeleton-bar" />
              </div>
            ))}
          </div>
        ) : null}
        <div className={fields ? `route-skeleton-panel ${styles.fields}` : "route-skeleton-rows"}>
          {Array.from({ length: fields ? 4 : 6 }, (_, index) => (
            <div className={fields ? styles.field : "route-skeleton-list-row"} key={index}>
              <div className="route-skeleton-stack">
                <span className={`internal-page-skeleton-bar ${styles.short}`} />
                <span className={`internal-page-skeleton-bar ${fields ? styles.input : styles.subtitle}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
