type Props = {
  tone?: "neutral" | "info" | "success" | "warning" | "danger" | "accent";
  children: string;
  title?: string;
};

export function StatusBadge({ tone = "neutral", children, title }: Props) {
  return (
    <span className={`status-badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function statusTone(status: string): Props["tone"] {
  const key = status.trim().toUpperCase().replace(/\s+/g, "_");
  switch (key) {
    case "IN_PROGRESS":
    case "PROGRESS":
    case "SENT":
    case "SCHEDULED":
    case "QUEUED":
    case "WAITING":
    case "ON_HOLD":
    case "MEDIUM":
      return "info";
    case "BLOCKED":
    case "FAILED":
    case "OVERDUE":
    case "REJECTED":
    case "CANCELLED":
    case "NO_SHOW":
    case "DISMISSED":
    case "HIGH":
      return "danger";
    case "DONE":
    case "RESOLVED":
    case "WON":
    case "COMPLETED":
    case "SHORTLISTED":
    case "BIDDED":
    case "PASSED":
      return "success";
    case "DRAFT":
    case "NEW":
      return "warning";
    case "TODO":
    case "OPEN":
    case "BACKLOG":
    case "WITHDRAWN":
    case "LOW":
      return "neutral";
    default:
      return "neutral";
  }
}
