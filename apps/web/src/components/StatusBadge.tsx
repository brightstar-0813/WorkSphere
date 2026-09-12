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
  switch (status) {
    case "IN_PROGRESS":
    case "PROGRESS":
    case "SENT":
    case "SCHEDULED":
    case "QUEUED":
      return "info";
    case "BLOCKED":
    case "FAILED":
    case "OVERDUE":
    case "REJECTED":
    case "CANCELLED":
    case "NO_SHOW":
    case "DISMISSED":
      return "danger";
    case "DONE":
    case "RESOLVED":
    case "WON":
    case "COMPLETED":
    case "SHORTLISTED":
    case "BIDDED":
      return "success";
    case "TODO":
    case "OPEN":
    case "BACKLOG":
    case "DRAFT":
    case "NEW":
      return "warning";
    case "WITHDRAWN":
      return "neutral";
    case "HIGH":
      return "danger";
    case "MEDIUM":
      return "info";
    case "LOW":
      return "neutral";
    default:
      return "neutral";
  }
}
