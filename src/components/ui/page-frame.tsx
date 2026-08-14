import type { ReactNode } from "react";

export function PageFrame({
  title,
  description,
  action,
  children,
  narrow = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className={narrow ? "page-frame page-frame-narrow" : "page-frame"}>
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
