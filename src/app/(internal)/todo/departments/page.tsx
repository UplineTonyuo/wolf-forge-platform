import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText, Mic } from "lucide-react";
import styles from "./departments.module.css";

export const metadata: Metadata = { title: "Operations — Departments" };

const PODCAST_SEO_ROUTE = "/todo/departments/podcast-seo";
const CONTENT_ROUTE = "/todo/departments/content";

const UPCOMING_DEPARTMENTS = [
  {
    name: "On-page SEO",
    description: "Page-level optimization and content workflows.",
  },
  {
    name: "Off-page SEO",
    description: "Authority-building and outreach workflows.",
  },
  {
    name: "GMB Management",
    description: "Local profile and listing operations.",
  },
  {
    name: "Technical SEO",
    description: "Site health and implementation workflows.",
  },
  {
    name: "YouTube SEO",
    description: "Channel and video optimization workflows.",
  },
  {
    name: "Website Builder",
    description: "Website production and delivery workflows.",
  },
  {
    name: "WF Media",
    description: "Media production and distribution workflows.",
  },
] as const;

function entranceOrder(order: number): CSSProperties {
  return { "--directory-order": order } as CSSProperties;
}

export default function DepartmentsPage() {
  return (
    <section className={styles.directory} aria-labelledby="department-directory-heading">
      <header className={styles.directoryHeader}>
        <div className={styles.directoryHeading}>
          <h2 id="department-directory-heading">Department directory</h2>
          <p>Open live operational workflows and see what is being prepared next.</p>
        </div>

        <p className={styles.directorySummary} aria-label="2 department workspaces and 7 coming soon">
          <span className={styles.summaryLive}>
            <span className={styles.liveDot} aria-hidden="true" />
            2 workspaces
          </span>
          <span className={styles.summaryDivider} aria-hidden="true" />
          <span>7 coming soon</span>
        </p>
      </header>

      <div className={styles.activeDepartment}>
        <h3>Active workspace</h3>
        <div className={styles.activeDepartmentGrid}>
          <Link
            href={PODCAST_SEO_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard}`}
            style={entranceOrder(0)}
            aria-label="Open Podcast SEO department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true">
              <Mic />
            </span>

            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>
                <span className={styles.liveStatusDot} aria-hidden="true" />
                Connected
              </span>
              <strong>Podcast SEO</strong>
              <span>Review the current podcast workflow and operational status.</span>
            </span>

            <span className={styles.liveAction} aria-hidden="true">
              <ArrowRight />
            </span>
          </Link>

          <Link
            href={CONTENT_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            style={entranceOrder(1)}
            aria-label="Open Content department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true">
              <FileText />
            </span>

            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
              <strong>Content</strong>
              <span>Search, filter, and inspect the monthly Content workflow.</span>
            </span>

            <span className={styles.liveAction} aria-hidden="true">
              <ArrowRight />
            </span>
          </Link>
        </div>
      </div>

      <section className={styles.upcomingSection} aria-labelledby="upcoming-departments-heading">
        <div className={styles.upcomingHeader}>
          <h3 id="upcoming-departments-heading">Coming soon</h3>
          <span>7 departments in preparation</span>
        </div>

        <div className={styles.departmentGrid} role="list" aria-label="Coming soon departments">
          {UPCOMING_DEPARTMENTS.map((department, index) => (
            <article
              key={department.name}
              className={`${styles.departmentCard} ${styles.upcomingItem}`}
              style={entranceOrder(index + 1)}
              role="listitem"
            >
              <div>
                <h4>{department.name}</h4>
                <p>{department.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
