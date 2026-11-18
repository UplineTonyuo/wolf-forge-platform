import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleDollarSign,
  Repeat2,
  ShoppingBag,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { DashboardReportingControl } from "../../../components/dashboard/dashboard-reporting-control";
import { SalesTrendChart } from "../../../components/dashboard/sales-trend-chart";
import chartStyles from "../../../components/dashboard/sales-trend-chart.module.css";
import { TopServicesPanel } from "../../../components/dashboard/top-services-panel";
import { assignServiceIconsById } from "../../../components/services/service-icons";
import { DataError } from "../../../components/ui/list-states";
import {
  dashboardPresets,
  type DashboardPreset,
  type MetricComparison,
} from "../../../domain/dashboard/schema";
import {
  formatBusinessDate,
  formatBusinessHour,
  toBusinessDateKey,
} from "../../../lib/dashboard/date-range";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { formatCurrencyCents } from "../../../lib/format";
import { defaultReportingPreset, yearToDateRange } from "../../../lib/dashboard/reporting-presets";
import { emptyRevenuePoints } from "../../../lib/dashboard/empty-revenue-points";
import { getInternalContext } from "../../../lib/supabase/next-server";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Dashboard" };

function isPreset(value: string | undefined): value is DashboardPreset {
  return Boolean(value) &&
    (dashboardPresets as readonly string[]).includes(value as string);
}

function comparisonLabel(
  metric: MetricComparison,
  formatPrevious: (value: number) => string,
) {
  if (metric.percent_change === null) {
    return `No prior baseline / previous ${formatPrevious(metric.previous)}`;
  }

  const rounded = Math.round(metric.percent_change * 10) / 10;
  const direction = rounded > 0 ? "+" : "";

  return `${direction}${rounded}% vs previous period`;
}

function MetricCard({
  icon,
  label,
  value,
  metric,
  note,
  formatPrevious,
  featured = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  metric?: MetricComparison;
  note: string;
  formatPrevious?: (value: number) => string;
  featured?: boolean;
}) {
  const delta = metric
    ? comparisonLabel(
        metric,
        formatPrevious ?? ((previous) => String(previous)),
      )
    : "Current snapshot";

  const tone =
    metric?.percent_change === null
      ? styles.deltaNeutral
      : (metric?.percent_change ?? 0) >= 0
        ? styles.deltaPositive
        : styles.deltaNegative;

  /*
   * Non-interactive on purpose. These KPIs have no trustworthy period-scoped
   * drill-down route today, so chevrons / lift / arrow motion would be a false
   * affordance. Keep the article as a reading surface only.
   */
  return (
    <article
      className={`${styles.metricCard} ${
        featured ? styles.metricFeatured : ""
      }`}
    >
      <div className={styles.metricHalo} aria-hidden="true" />

      <div className={styles.metricHeader}>
        <span className={styles.metricIcon}>{icon}</span>
      </div>

      <div className={styles.metricBody}>
        <span className={styles.metricLabel}>{label}</span>
        <strong className={styles.metricValue}>{value}</strong>
      </div>

      <div className={styles.metricFooter}>
        <span className={tone}>{delta}</span>
        <span className={styles.metricNote}>{note}</span>
      </div>
    </article>
  );
}

type DashboardServices = Awaited<ReturnType<typeof getInternalContext>>["services"];

async function ActiveSubscriptionsCard({ request }: { request: Promise<number | null> }) {
  const count = await request;
  return <MetricCard
    icon={<Repeat2 size={18} aria-hidden="true" />}
    label="Active subscriptions"
    value={count === null ? "—" : String(count)}
    note={count === null ? "Working SEO order count unavailable" : "Working Local SEO and GMB orders"}
  />;
}

async function SalesTrendSection({ dashboard, timeZone, chartKey, ...chart }: {
  dashboard: DashboardServices["dashboard"];
  timeZone: string;
  chartKey: string;
} & Required<Parameters<typeof SalesTrendChart>[0]>) {
  let historyStart: string | null;
  try {
    historyStart = await dashboard.getHistoryStart(chart.currency);
  } catch (error) {
    return <DataError message={toClientSafeError(error).message} />;
  }

  return <SalesTrendChart key={chartKey} {...chart} window={{
    ...chart.window,
    earliest: historyStart ? toBusinessDateKey(new Date(historyStart), timeZone) : null,
  }} />;
}

async function TopServicesSection({ topServicesRequest, catalogRequest, timeZone: tz, initialPeriod }: {
  topServicesRequest: Promise<(Awaited<ReturnType<DashboardServices["dashboard"]["getTopServices"]>> | null)[]>;
  catalogRequest: ReturnType<DashboardServices["catalog"]["listCatalogOptions"]>;
  timeZone: string;
  initialPeriod: "week" | "month" | "year";
}) {
  const [topServices, catalog] = await Promise.all([topServicesRequest, catalogRequest]);
  const serviceIcons = assignServiceIconsById(catalog.map((service) => ({
    id: service.id, name: service.name, folderId: service.folder_id,
  })));

  function servicePanel(result: typeof topServices[number]) {
    return {
      rangeLabel: result
        ? `${formatBusinessDate(result.range.start, tz)} to ${formatBusinessDate(new Date(Date.parse(result.range.end) - 1).toISOString(), tz)}` : "",
      content: result ? result.services.length ? <ol className={styles.topServicesList}>
        {result.services.map((service, index) => {
          const ServiceIcon = serviceIcons.get(service.service_id ?? "") ?? ShoppingBag;
          return <li key={service.service_id ?? service.name}>
            <span className={styles.serviceRank} aria-hidden="true">{index + 1}</span>
            <span className={styles.serviceGlyph}><ServiceIcon size={19} aria-hidden="true" /></span>
            <strong className={styles.serviceName}>{service.name}</strong>
            <span className={styles.serviceCount}><strong>{service.paid_orders}</strong><small>paid {service.paid_orders === 1 ? "order" : "orders"}</small></span>
          </li>;
        })}
      </ol> : <div className={styles.softEmpty}>No paid orders in this period.</div>
        : <div className={styles.softEmpty} role="status">Top services couldn’t be loaded. Try refreshing.</div>,
    };
  }

  return <TopServicesPanel key={initialPeriod} initialPeriod={initialPeriod} periods={{
    week: servicePanel(topServices[0] ?? null), month: servicePanel(topServices[1] ?? null), year: servicePanel(topServices[2] ?? null),
  }} />;
}

function TopServicesLoading() {
  return <article className={styles.topServicesPanel} aria-busy="true" aria-label="Loading top services" role="status">
    <div className={styles.panelHead}><div className={styles.panelTitle}>
      <span className={styles.panelIcon}><ShoppingBag size={17} aria-hidden="true" /></span>
      <div><span>Paid orders</span><h2>Top services</h2><p>Loading services...</p></div>
    </div></div>
    <ol className={styles.topServicesList} aria-hidden="true">{[0, 1, 2, 3, 4].map((row) => <li key={row}>
      <span className="internal-page-skeleton-bar" style={{ width: 12 }} />
      <span className="internal-page-skeleton-bar" style={{ width: 36, height: 36 }} />
      <span className="internal-page-skeleton-bar" style={{ width: "70%" }} />
      <span className="internal-page-skeleton-bar" style={{ width: 56, height: 28 }} />
    </li>)}</ol>
  </article>;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    date?: string;
    from?: string;
    to?: string;
    servicesPeriod?: string;
  }>;
}) {
  const [params, context] = await Promise.all([
    searchParams,
    getInternalContext(),
  ]);

  const preset: DashboardPreset = isPreset(params.period)
    ? params.period
    : defaultReportingPreset;

  const businessToday = toBusinessDateKey(new Date());
  const servicesPeriod = params.servicesPeriod === "week" || params.servicesPeriod === "year"
    ? params.servicesPeriod : "month";
  const topServicesRequest = Promise.all([
    context.services.dashboard.getTopServices({ preset: "last_7_days" }).catch(() => null),
    context.services.dashboard.getTopServices({ preset: "this_month" }).catch(() => null),
    context.services.dashboard.getTopServices({ preset: "custom_range", ...yearToDateRange(businessToday) }).catch(() => null),
  ]);
  const catalogRequest = context.user.modules.services
    ? context.services.catalog.listCatalogOptions().catch(() => []) : Promise.resolve([]);
  const workingSeoRequest = context.user.modules.projects && context.user.modules.services
    ? context.services.dashboard.getWorkingSeoOrderCount().catch(() => null) : Promise.resolve(null);

  let overview;

  try {
    overview = await context.services.dashboard.getOverview({
      preset,
      date: params.date,
      from: params.from,
      to: params.to,
    });
  } catch (error) {
    return (
      <main className={styles.page}>
        <DataError message={toClientSafeError(error).message} />
      </main>
    );
  }

  const {
    revenue,
    clients,
    sales_trend: salesTrend,
  } = overview;


  const headline = revenue.current.find(
    (entry) => entry.currency === revenue.headline_currency,
  );

  const previousHeadline = revenue.previous.find(
    (entry) => entry.currency === revenue.headline_currency,
  );

  const otherCurrencies = revenue.current.filter(
    (entry) => entry.currency !== revenue.headline_currency,
  );

  const revenueComparison: MetricComparison = {
    current: headline?.net_cents ?? 0,
    previous: previousHeadline?.net_cents ?? 0,
    delta:
      (headline?.net_cents ?? 0) -
      (previousHeadline?.net_cents ?? 0),
    percent_change: previousHeadline?.net_cents
      ? (((headline?.net_cents ?? 0) -
          previousHeadline.net_cents) /
          previousHeadline.net_cents) *
        100
      : null,
  };

  const headlineTrend = salesTrend.find(
    (series) => series.currency === revenue.headline_currency,
  );

  const trendPoints = headlineTrend?.points.length ? headlineTrend.points : emptyRevenuePoints(overview.range);
  const tz = overview.range.timeZone;
  const bucketLabel = (bucketStart: string) =>
    overview.range.bucket === "hour"
      ? formatBusinessHour(bucketStart, tz)
      : formatBusinessDate(bucketStart, tz);

  const lastDayInRange = new Date(
    Date.parse(overview.range.end) - 1,
  ).toISOString();

  const startLabel = formatBusinessDate(overview.range.start, tz);
  const endLabel = formatBusinessDate(lastDayInRange, tz);
  const rangeLabel =
    startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;

  const shortDate = new Intl.DateTimeFormat("en", {
    timeZone: tz, month: "short", ...(trendPoints.length <= 31 ? { day: "numeric" as const } : {}),
  });

  const headlineMoney = formatCurrencyCents(
    headline?.net_cents ?? 0,
    revenue.headline_currency,
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>
            {context.user.greetingName
              ? `Welcome back, ${context.user.greetingName}`
              : "Welcome back"}
          </h1>
          <p>
            Paid revenue, top services, client activity, and recurring
            business in one live view.
          </p>
        </div>
        <DashboardReportingControl
          preset={preset}
          businessToday={businessToday}
        />
      </section>

      <section className={styles.metricGrid} aria-label="Executive metrics">
        <MetricCard
          icon={<CircleDollarSign size={19} aria-hidden="true" />}
          label={`Total revenue / ${revenue.headline_currency}`}
          value={headlineMoney}
          metric={revenueComparison}
          formatPrevious={(value) =>
            formatCurrencyCents(value, revenue.headline_currency)
          }
          note={
            headline?.refunds_cents
              ? `Net of ${formatCurrencyCents(
                  headline.refunds_cents,
                  revenue.headline_currency,
                )} refunded`
              : "Successful payments, net of refunds"
          }
          featured
        />

        <MetricCard
          icon={<ShoppingBag size={18} aria-hidden="true" />}
          label="Paid orders"
          value={String(overview.paid_orders.current)}
          metric={overview.paid_orders}
          note="Orders on fully paid invoices"
        />

        <MetricCard
          icon={<UsersRound size={18} aria-hidden="true" />}
          label="Clients added"
          value={String(clients.converted.current)}
          metric={clients.converted}
          note={`${clients.created.current} new contacts entered the pipeline`}
        />

        <Suspense fallback={<MetricCard
          icon={<Repeat2 size={18} aria-hidden="true" />}
          label="Active subscriptions"
          value="—"
          note="Loading Working Local SEO and GMB orders"
        />}>
          <ActiveSubscriptionsCard request={workingSeoRequest} />
        </Suspense>
      </section>

      {otherCurrencies.length ? (
        <section className={styles.currencyRail}>
          <span>Collected outside headline currency</span>
          <div>
            {otherCurrencies.map((entry) => (
              <strong key={entry.currency}>
                {formatCurrencyCents(entry.net_cents, entry.currency)}
                <small>{entry.currency}</small>
              </strong>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.salesPanel}>
        <div className={styles.panelHead}>
          <div className={styles.panelTitle}>
            <span className={styles.panelIcon}>
              <TrendingUp size={17} aria-hidden="true" />
            </span>
            <div>
              <span>Sales trend</span>
              <h2>{headlineMoney}</h2>
              <p>
                Collected revenue, net of refunds / {revenue.headline_currency} / {rangeLabel}
              </p>
            </div>
          </div>

          <div className={styles.legend}>
            <span>
              <i />
              Net revenue
            </span>
            <strong>{overview.range.bucket === "hour" ? "Hourly" : overview.range.bucket === "week" ? "Weekly" : "Daily"}</strong>
          </div>
        </div>

        <Suspense fallback={<div role="status" aria-busy="true" aria-label="Loading sales trend">
          <div className={chartStyles.figure}>
            <div className={chartStyles.history}>
              <span>Loading revenue history...</span>
              <div aria-hidden="true">{[0, 1].map((item) => <span key={item} className="internal-page-skeleton-bar" style={{ width: 44, height: 44 }} />)}</div>
              <span className={chartStyles.historyStatus} aria-hidden="true" />
            </div>
            <div className={chartStyles.chart} aria-hidden="true">
              <span className="internal-page-skeleton-bar" style={{ gridColumn: 2, gridRow: 1, height: "100%" }} />
            </div>
            <div className={chartStyles.data} aria-hidden="true"><div style={{ minHeight: 44 }} /></div>
          </div>
        </div>}>
          <SalesTrendSection key={`${overview.range.start}:${overview.range.end}`}
            chartKey={`${overview.range.start}:${overview.range.end}`} dashboard={context.services.dashboard} timeZone={tz}
            currency={revenue.headline_currency}
            window={{ from: toBusinessDateKey(new Date(overview.range.start), tz), to: toBusinessDateKey(new Date(lastDayInRange), tz), today: businessToday, earliest: null }}
            points={trendPoints.map((point) => ({
              value: point.net_cents,
              label: bucketLabel(point.bucket_start),
              axisLabel: overview.range.bucket === "hour" ? formatBusinessHour(point.bucket_start, tz) : shortDate.format(new Date(point.bucket_start)),
              money: formatCurrencyCents(point.net_cents, revenue.headline_currency),
            }))} />
        </Suspense>
      </section>

      <section className={styles.insightGrid}>
        <Suspense fallback={<TopServicesLoading />}>
          <TopServicesSection topServicesRequest={topServicesRequest} catalogRequest={catalogRequest} timeZone={tz} initialPeriod={servicesPeriod} />
        </Suspense>
        <article className={styles.subscriptionPanel}>
          <div className={styles.subscriptionOrb} aria-hidden="true" />

          <div className={styles.subscriptionHeader}>
            <span className={styles.panelIcon}>
              <Repeat2 size={17} aria-hidden="true" />
            </span>
            <span>Subscription pulse</span>
          </div>

          <strong className={styles.subscriptionValue}>
            {overview.active_subscriptions.billable}
          </strong>

          <p>
            Billable subscriptions active right now, with{" "}
            <strong>{overview.new_subscriptions.current}</strong> started in
            the selected period.
          </p>

          <div className={styles.statusList}>
            {overview.active_subscriptions.by_status.length ? (
              overview.active_subscriptions.by_status.map((entry) => (
                <div key={entry.status}>
                  <span>{entry.status.replaceAll("_", " ")}</span>
                  <strong>{entry.count}</strong>
                </div>
              ))
            ) : (
              <span className={styles.noStatus}>No active subscriptions.</span>
            )}
          </div>
          {context.user.modules.subscriptions ? (
            <Link href="/subscriptions" className={styles.subscriptionLink}>
              View subscriptions <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ) : null}
        </article>
      </section>
    </main>
  );
}
