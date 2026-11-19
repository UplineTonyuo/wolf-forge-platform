import styles from "../../../../../components/projects/project-detail.module.css";
import { AccountAvatar } from "../../../../../components/ui/account-avatar";
import { DataError } from "../../../../../components/ui/list-states";
import type { ActivityEvent } from "../../../../../domain/activity/schema";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { formatDate, formatDateTime } from "../../../../../lib/format";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

function RevisionReason({ event }: { event: ActivityEvent }) {
  const metadata = event.metadata;
  if (event.action !== "order.status_changed" || !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
    typeof metadata.revision_id !== "string" || typeof metadata.reason !== "string") return null;
  return <p className={styles.revisionReason}>{metadata.reason}</p>;
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
    for (const event of activity) {
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
                            {(event.actor_profile_id ? nameById.get(event.actor_profile_id) : null) ?? "Wolf Forge"}
                          </strong>{" "}
                          {event.summary}
                        </p>
                        <RevisionReason event={event}/>
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
