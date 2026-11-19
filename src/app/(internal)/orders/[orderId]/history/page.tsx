import type { ActivityEventRow } from "../../../../../lib/supabase/database-rows";
import styles from "../../../../../components/projects/project-detail.module.css";
import { AccountAvatar } from "../../../../../components/ui/account-avatar";
import { DataError } from "../../../../../components/ui/list-states";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { formatDate, formatDateTime } from "../../../../../lib/format";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

function sourceHistory(event: ActivityEventRow) {
  const meta = event.metadata;
  if (event.entity_type !== "order" || event.action !== "order.spp_history"
    || !meta || typeof meta !== "object" || Array.isArray(meta) || meta.source !== "spp"
    || typeof meta.source_event_id !== "string" || !/^\d{1,32}$/.test(meta.source_event_id)
    || typeof meta.source_actor_label !== "string" || !meta.source_actor_label.trim()) return null;
  return { id: BigInt(meta.source_event_id), actor: meta.source_actor_label };
}

// Native events keep their positions even when an import shares the same timestamp.
function orderSourceTies(events: ActivityEventRow[]) {
  const result = events.slice();
  const byTime = new Map<string, { index: number; event: ActivityEventRow; id: bigint }[]>();
  events.forEach((event, index) => {
    const source = sourceHistory(event);
    if (!source) return;
    const group = byTime.get(event.created_at) ?? [];
    group.push({ index, event, id: source.id });
    byTime.set(event.created_at, group);
  });
  for (const group of byTime.values()) {
    const sorted = [...group].sort((a, b) => a.id === b.id ? 0 : a.id > b.id ? -1 : 1);
    group.forEach(({ index }, i) => { result[index] = sorted[i]!.event; });
  }
  return result;
}

export default async function OrderHistoryPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const context = await getInternalContext();

  try {
    const [activity, people] = await Promise.all([
      context.services.activity.listTimeline("order", orderId),
      context.services.catalog.listAssignees(),
    ]);

    const nameById = new Map(people.map((person) => [person.id, person.displayName]));

    const groups = new Map<string, typeof activity>();
    for (const event of orderSourceTies(activity)) {
      const dateKey = formatDate(event.created_at);
      const existing = groups.get(dateKey);
      if (existing) existing.push(event);
      else groups.set(dateKey, [event]);
    }

    return (
      <section aria-labelledby="order-history-heading">
        <h2 id="order-history-heading" className={styles.sectionHeading}>
          History
        </h2>

        {activity.length === 0 ? (
          <p className={styles.panelEmpty}>No activity has been recorded yet.</p>
        ) : (
          <div className={styles.historyStream}>
            {Array.from(groups.entries()).map(([dateKey, events]) => (
              <div key={dateKey} className={styles.historyGroup}>
                <h3 className={styles.historyGroupHeading}>{dateKey}</h3>

                <ul className={styles.historyList}>
                  {events.map((event) => (
                    <li key={event.id}>
                      <AccountAvatar avatarUrl={null} size={28} />

                      <div className={styles.historyBody}>
                        <p>
                          <strong>
                            {sourceHistory(event)?.actor ?? (event.actor_profile_id ? nameById.get(event.actor_profile_id) : null) ?? "Wolf Forge"}
                          </strong>{" "}
                          {event.summary}
                        </p>
                        <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    return <DataError message={safe.message} />;
  }
}
