import type { Metadata } from "next";
import {
  ChevronRight,
  CircleDollarSign,
  Repeat2,
  ShoppingBag,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { DashboardReportingControl } from "../../../components/dashboard/dashboard-reporting-control";
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
import { getInternalContext } from "../../../lib/supabase/next-server";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Dashboard" };

const zeroColumns = [3, 5, 2, 6, 4, 7, 3, 5, 2, 6, 4, 5];

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

  return (
    <article
      className={`${styles.metricCard} ${
        featured ? styles.metricFeatured : ""
      }`}
    >
      <div className={styles.metricHalo} aria-hidden="true" />

      <div className={styles.metricHeader}>
        <span className={styles.metricIcon}>{icon}</span>
        <span className={styles.metricArrow}>
          <ChevronRight size={15} aria-hidden="true" />
        </span>
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    date?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const [params, context] = await Promise.all([
    searchParams,
    getInternalContext(),
  ]);

  const preset: DashboardPreset = isPreset(params.period)
    ? params.period
    : "last_30_days";

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
    client_growth: growth,
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

  const trendPoints = headlineTrend?.points ?? [];
  const trendMax = trendPoints.reduce(
    (max, point) => Math.max(max, Math.abs(point.net_cents)),
    0,
  );

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

  const totalGrowth = growth.points.reduce(
    (totals, point) => ({
      contact: totals.contact + point.to_contact,
      lead: totals.lead + point.to_lead,
      client: totals.client + point.to_client,
      clientTeam: totals.clientTeam + point.to_client_team,
    }),
    {
      contact: 0,
      lead: 0,
      client: 0,
      clientTeam: 0,
    },
  );

  const headlineMoney = formatCurrencyCents(
    headline?.net_cents ?? 0,
    revenue.headline_currency,
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>Welcome back, William</h1>
          <p>
            Paid revenue, completed sales, client growth, and recurring
            business in one live view.
          </p>
        </div>
        <DashboardReportingControl
          preset={preset}
          businessToday={toBusinessDateKey(new Date())}
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

        <MetricCard
          icon={<Repeat2 size={18} aria-hidden="true" />}
          label="Active subscriptions"
          value={String(overview.active_subscriptions.billable)}
          note={`${overview.new_subscriptions.current} new in selected period`}
        />
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
                Paid revenue in {revenue.headline_currency} / {rangeLabel}
              </p>
            </div>
          </div>

          <div className={styles.legend}>
            <span>
              <i />
              Paid revenue
            </span>
            <strong>{overview.range.bucket} buckets</strong>
          </div>
        </div>

        {trendPoints.length && trendMax > 0 ? (
          <div className={styles.chartViewport}>
            <div className={styles.chart}>
              {trendPoints.map((point) => {
                const ratio = Math.abs(point.net_cents) / trendMax;
                const filled = Math.max(1, Math.round(ratio * 10));

                return (
                  <div className={styles.chartColumn} key={point.bucket_start}>
                    <div
                      className={styles.chartBlocks}
                      title={`${bucketLabel(
                        point.bucket_start,
                      )}: ${formatCurrencyCents(
                        point.net_cents,
                        revenue.headline_currency,
                      )}`}
                    >
                      {Array.from({ length: 10 }).map((_, index) => (
                        <span
                          key={index}
                          className={
                            index >= 10 - filled
                              ? styles.blockFilled
                              : styles.blockGhost
                          }
                        />
                      ))}
                    </div>

                    <time
                      className={styles.chartLabel}
                      dateTime={point.bucket_start}
                    >
                      {bucketLabel(point.bucket_start)}
                    </time>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={styles.zeroChart} aria-label="No paid revenue">
            <div className={styles.zeroGrid} aria-hidden="true">
              {zeroColumns.map((height, index) => (
                <div className={styles.zeroColumn} key={index}>
                  {Array.from({ length: 8 }).map((_, blockIndex) => (
                    <span
                      key={blockIndex}
                      className={
                        blockIndex >= 8 - height
                          ? styles.zeroBlockActive
                          : styles.zeroBlock
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={styles.insightGrid}>
        <article className={styles.clientPanel}>
          <div className={styles.panelHead}>
            <div className={styles.panelTitle}>
              <span className={styles.panelIcon}>
                <UsersRound size={17} aria-hidden="true" />
              </span>
              <div>
                <span>Client growth</span>
                <h2>{clients.converted.current}</h2>
                <p>Conversions into Client during the selected period</p>
              </div>
            </div>
          </div>

          {growth.supported ? (
            <>
              <div className={styles.pipeline}>
                <div className={styles.pipelineStage}>
                  <span>Contact</span>
                  <strong>{totalGrowth.contact}</strong>
                </div>
                <div className={styles.pipelineLine}>
                  <span />
                </div>
                <div className={styles.pipelineStage}>
                  <span>Lead</span>
                  <strong>{totalGrowth.lead}</strong>
                </div>
                <div className={styles.pipelineLine}>
                  <span />
                </div>
                <div className={styles.pipelineStage}>
                  <span>Client</span>
                  <strong>{totalGrowth.client}</strong>
                </div>
                <div className={styles.pipelineLine}>
                  <span />
                </div>
                <div className={styles.pipelineStage}>
                  <span>Client Team</span>
                  <strong>{totalGrowth.clientTeam}</strong>
                </div>
              </div>

              <p className={styles.supportNote}>
                Based on persisted company status transitions available to
                the platform.
              </p>
            </>
          ) : (
            <div className={styles.softEmpty}>
              Historical client status tracking is unavailable for this
              reporting window.
            </div>
          )}
        </article>

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
        </article>
      </section>
    </main>
  );
}