"use client";

import { ShoppingBag } from "lucide-react";
import { useState, type ReactNode } from "react";
import styles from "../../app/(internal)/dashboard/dashboard.module.css";

export type ServicePeriod = "week" | "month" | "year";
export type ServicePeriodPanel = { rangeLabel: string; content: ReactNode };

export function TopServicesPanel({ initialPeriod, periods }: {
  initialPeriod: ServicePeriod;
  periods: Record<ServicePeriod, ServicePeriodPanel>;
}) {
  const [selected, setSelected] = useState(initialPeriod);

  function choose(period: ServicePeriod) {
    if (period === selected) return;
    setSelected(period);
    const url = new URL(window.location.href);
    url.searchParams.set("servicesPeriod", period);
    // Native history keeps the date control in sync without another page render.
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return <article className={styles.topServicesPanel}>
    <div className={`${styles.panelHead} ${styles.topServicesHeader}`}>
      <div className={styles.panelTitle}>
        <span className={styles.panelIcon}><ShoppingBag size={17} aria-hidden="true" /></span>
        <div><span>Paid orders</span><h2>Top services</h2>
          <p>{periods[selected].rangeLabel}</p>
        </div>
      </div>
      <nav className={styles.servicePeriods} aria-label="Top services period">
        {(["week", "month", "year"] as const).map((period) => <button key={period}
          type="button" aria-pressed={selected === period} onClick={() => choose(period)}>
          {period === "week" ? "Week" : period === "month" ? "Month" : "Year"}
        </button>)}
      </nav>
    </div>
    <div className={styles.serviceResults} aria-live="polite">
      {(["week", "month", "year"] as const).map((period) => <div key={period}
        className={styles.serviceResult} aria-hidden={selected !== period}
        data-active={selected === period}>
        {periods[period].content}
      </div>)}
    </div>
  </article>;
}
