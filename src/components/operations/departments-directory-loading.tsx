import styles from "../../app/(internal)/todo/departments/departments.module.css";

const CARDS = Array.from({ length: 8 }, (_, index) => index);

/**
 * Reuses the real Departments directory's own CSS module classes (the exact
 * header/grid/card geometry `departments/page.tsx` renders) instead of a
 * parallel set of skeleton-only layout classes, so this boundary occupies
 * the destination's real geometry rather than an approximation of it. Only
 * the per-card content (icon/title/description) is a pulsing placeholder —
 * the header copy is real, static chrome, not fetched data.
 */
export function DepartmentsDirectoryLoading() {
  return (
    <section
      className={styles.directory}
      role="status"
      aria-label="Loading department directory"
      aria-busy="true"
    >
      <header className={styles.directoryHeader}>
        <div className={styles.directoryHeading}>
          <h2>Department directory</h2>
          <p>Open live operational workflows across Wolf Forge.</p>
        </div>
        <p className={styles.directorySummary}>8 workspaces</p>
      </header>

      <div className={styles.activeDepartment}>
        <h3>Workspaces</h3>
        <div className={styles.activeDepartmentGrid} aria-hidden="true">
          {CARDS.map((card) => (
            <div
              className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
              key={card}
            >
              <span className={`${styles.liveIcon} departments-skeleton-icon`} />
              <span className={styles.liveCardCopy}>
                <span className="departments-skeleton-copy-title" />
                <span className="departments-skeleton-copy-line" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
