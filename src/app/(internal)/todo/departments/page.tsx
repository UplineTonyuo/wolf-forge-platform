import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText, LayoutTemplate, Link2, MapPinned, Mic, ScanSearch, SquarePlay } from "lucide-react";
import styles from "./departments.module.css";

export const metadata: Metadata = { title: "Operations — Departments" };

const PODCAST_SEO_ROUTE = "/todo/departments/podcast-seo";
const CONTENT_ROUTE = "/todo/departments/content";
const ON_PAGE_SEO_ROUTE = "/todo/departments/on-page-seo";
const GMB_MANAGEMENT_ROUTE = "/todo/departments/gmb-management";
const YOUTUBE_SEO_ROUTE = "/todo/departments/youtube-seo";
const WEBSITE_BUILDER_ROUTE = "/todo/departments/website-builder";
const OFF_PAGE_SEO_ROUTE = "/todo/departments/off-page-seo";

export default function DepartmentsPage() {
  return (
    <section className={styles.directory} aria-labelledby="department-directory-heading">
      <header className={styles.directoryHeader}>
        <div className={styles.directoryHeading}>
          <h2 id="department-directory-heading">Department directory</h2>
          <p>Open live operational workflows across Wolf Forge.</p>
        </div>

        <p className={styles.directorySummary}>8 workspaces</p>
      </header>

      <div className={styles.activeDepartment}>
        <h3>Workspaces</h3>
        <div className={styles.activeDepartmentGrid}>
          <Link
            href={PODCAST_SEO_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            aria-label="Open Podcast SEO department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true">
              <Mic />
            </span>

            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
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

          <Link
            href={ON_PAGE_SEO_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            aria-label="Open On-page SEO department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true">
              <ScanSearch />
            </span>

            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
              <strong>On-page SEO</strong>
              <span>Prepared for the approved On-page SEO workflow source.</span>
            </span>

            <span className={styles.liveAction} aria-hidden="true">
              <ArrowRight />
            </span>
          </Link>

          <Link
            href={GMB_MANAGEMENT_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            aria-label="Open GMB Management department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true">
              <MapPinned />
            </span>

            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
              <strong>GMB Management</strong>
              <span>Review GMB content, posting, and source outputs.</span>
            </span>

            <span className={styles.liveAction} aria-hidden="true">
              <ArrowRight />
            </span>
          </Link>

          <Link
            href={YOUTUBE_SEO_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            aria-label="Open YouTube SEO department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true">
              <SquarePlay />
            </span>

            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
              <strong>YouTube SEO</strong>
              <span>Track Wave Videos and YouTube upload progress by client.</span>
            </span>

            <span className={styles.liveAction} aria-hidden="true">
              <ArrowRight />
            </span>
          </Link>

          <Link
            href={WEBSITE_BUILDER_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            aria-label="Open Website Builder department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true">
              <LayoutTemplate />
            </span>

            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
              <strong>Website Builder</strong>
              <span>See what is in delivery, what is blocking it, and what is next.</span>
            </span>

            <span className={styles.liveAction} aria-hidden="true">
              <ArrowRight />
            </span>
          </Link>
          <Link
            href="/todo/departments/technical-seo"
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            aria-label="Open Technical SEO department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true"><ScanSearch /></span>
            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
              <strong>Technical SEO</strong>
              <span>Review technical, mobile, and desktop evidence and statuses.</span>
            </span>
            <span className={styles.liveAction} aria-hidden="true"><ArrowRight /></span>
          </Link>
          <Link
            href={OFF_PAGE_SEO_ROUTE}
            className={`${styles.departmentCard} ${styles.liveCard} ${styles.contentCard}`}
            aria-label="Open Off-page SEO department workflow"
          >
            <span className={styles.liveIcon} aria-hidden="true"><Link2 /></span>
            <span className={styles.liveCardCopy}>
              <span className={styles.liveStatus}>Workspace ready</span>
              <strong>Off-page SEO</strong>
              <span>See what off-page work is complete, blocked, and next.</span>
            </span>
            <span className={styles.liveAction} aria-hidden="true"><ArrowRight /></span>
          </Link>
        </div>
      </div>

    </section>
  );
}
