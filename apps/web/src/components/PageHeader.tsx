import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

/** Shared page title + optional actions (Job Handle / hunting pattern). */
export function PageHeader({ title, subtitle, actions, className }: Props) {
  const classes = ["page-header", className].filter(Boolean).join(" ");
  return (
    <header className={classes}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="itsm-header-actions">{actions}</div> : null}
    </header>
  );
}
