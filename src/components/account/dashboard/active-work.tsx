import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ClientActiveProject } from "../../../domain/client-portal/summary";
import { activeProjectProgressState } from "../../../domain/client-portal/next-action";
import styles from "./client-deck.module.css";

/**
 * What Wolf Forge is building, as a dossier rail.
 *
 * Deliberately not a card grid. Three equal bordered tiles gave a project code,
 * a title and a status the same weight and left nothing to scan by; stacked
 * rows on one surface let the eye run down the titles and pick up state from
 * the leading track without reading every field.
 *
 * A progress rail is drawn only when delivery tasks actually exist to measure.
 * When they do not, the project's translated status is stated in words — a 0%
 * bar reads as "no progress made", which is a different and usually false
 * claim.
 */
function ActiveProjectRow({
  project,
  index,
}: {
  project: ClientActiveProject;
  index: number;
}) {
  const progress = activeProjectProgressState(project);

  return (
    <li
      className={styles.railItem}
      style={{ "--wf-deck-index": index } as React.CSSProperties}
    >
      <Link href={project.href} className={styles.project} data-tone={project.tone}>
        <span className={styles.projectMain}>
          {/*
            * The name leads. The identifier follows it on the same line as a
            * quiet companion rather than a leading column — it is how the
            * project is looked up, not what it is called, and putting it first
            * made every row open with a code the client rarely reads.
            */}
          <span className={styles.projectTop}>
            <span className={styles.projectTitle}>{project.title}</span>
            <span className={styles.projectRefDot} aria-hidden={true} />
            <span className={styles.projectRef}>{project.reference}</span>
          </span>

          <span className={styles.projectMeta}>
            {/*
              * The state as a word rather than a pill. Same fact, same tone
              * vocabulary, far less furniture once several rows stack up.
              */}
            <span className={styles.projectState}>{project.toneLabel}</span>

            {project.serviceName ? (
              <>
                <span className={styles.metaDot} aria-hidden={true} />
                <span>{project.serviceName}</span>
              </>
            ) : null}

            {project.dueLabel ? (
              <>
                <span className={styles.metaDot} aria-hidden={true} />
                <span>{project.dueLabel}</span>
              </>
            ) : null}
          </span>
        </span>

        <span className={styles.projectAside}>
          {progress.kind === "measured" ? (
            <span className={styles.progress} role="img" aria-label={progress.label}>
              <span className={styles.progressValue}>{progress.percent}%</span>
              <span className={styles.progressTrack}>
                <span
                  className={styles.progressFill}
                  style={{ "--wf-rail-percent": `${progress.percent}%` } as React.CSSProperties}
                />
              </span>
            </span>
          ) : (
            <span className={styles.progressAbsent}>Progress not tracked yet</span>
          )}

          <ArrowRight className={styles.projectArrow} aria-hidden={true} />
        </span>
      </Link>
    </li>
  );
}

export function ActiveWorkSection({
  projects,
  totalProjects,
}: {
  projects: ClientActiveProject[];
  /** Null upstream means the Projects module is denied; the caller omits this. */
  totalProjects: number;
}) {
  return (
    <section className={styles.section} aria-labelledby="portal-active-work">
      <header className="portal-section-head">
        <h2 id="portal-active-work">Active work</h2>
        <Link className="portal-secondary-action" href="/account/projects">
          All projects
          <ArrowUpRight aria-hidden={true} />
        </Link>
      </header>

      {projects.length === 0 ? (
        <p className="portal-empty">
          {totalProjects === 0
            ? "No projects yet. When Wolf Forge starts work for your account, it appears here."
            : "Nothing is in progress right now. Your completed projects are on the Projects page."}
        </p>
      ) : (
        <ul className={styles.rail}>
          {projects.map((project, index) => (
            <ActiveProjectRow key={project.id} project={project} index={index} />
          ))}
        </ul>
      )}
    </section>
  );
}
