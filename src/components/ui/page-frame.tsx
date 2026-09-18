import type { ReactNode } from "react";

export function PageFrame({
  title,
  description,
  action,
  children,
  narrow = false,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  narrow?: boolean;
  /** Extra frame-level class, for a page that needs to target the shared
   *  `.page-header` (which it cannot reach from its own children). */
  className?: string;
}) {
  return (
    <div
      className={[
        narrow ? "page-frame page-frame-narrow" : "page-frame",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="page-header">
        <div>
          <h1 id="main-heading" tabIndex={-1}>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="page-actions">{action}</div> : null}
      </header>
      {children}
    </div>
  );
}
