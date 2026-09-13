type Props = {
  /** Compact strip for topbars; full for login hero */
  variant?: "compact" | "hero";
  className?: string;
  label: string;
  message: string;
  criterion?: string;
  priority?: string;
};

export function GroupPriorityMark({
  variant = "compact",
  className = "",
  label,
  message,
  criterion,
  priority,
}: Props) {
  const meta = [criterion, priority].filter(Boolean).join(" · ");

  return (
    <div
      className={`group-priority group-priority-${variant}${className ? ` ${className}` : ""}`}
      aria-label={`${label}. ${message}`}
    >
      <span className="group-priority-rail" aria-hidden="true" />
      <div className="group-priority-copy">
        <span className="group-priority-label" translate="no">
          {label}
        </span>
        {meta ? <span className="group-priority-rank">{meta}</span> : null}
        <span className="group-priority-message">{message}</span>
      </div>
    </div>
  );
}
