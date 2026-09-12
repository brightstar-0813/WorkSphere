import { ReactNode, useId, useState } from "react";

export function CalCollapse({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={`cal-collapse${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="cal-collapse-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cal-collapse-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="cal-collapse-title">{title}</span>
        {summary ? <span className="cal-collapse-summary muted small">{summary}</span> : null}
      </button>
      {open ? (
        <div id={panelId} className="cal-collapse-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
