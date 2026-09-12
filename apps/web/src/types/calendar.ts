export type RecurFrequency =
  | "ONCE"
  | "DAILY"
  | "WEEKDAYS"
  | "WEEKLY"
  | "MONTHLY"
  | "CUSTOM";

export type CalEvent = {
  id: string;
  seriesId?: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  description: string;
  tag?: string;
  remindMinutes?: number;
  alertEnabled?: boolean;
  recur?: RecurFrequency | string;
  /** Comma-separated JS weekdays 0–6 when recur is CUSTOM */
  recurDays?: string | null;
  recurUntil?: string | null;
  sourceType: "JOB" | "HUNTING" | "TRANSACTION" | "MANUAL" | "GOOGLE" | "OUTLOOK";
  sourceId: string | null;
  /** job:{id} or profile:{id} when event belongs to an entity calendar */
  layerKey?: string | null;
  attendees?: string;
  htmlLink?: string | null;
  externalId?: string | null;
  sharedFrom?: { id: string; email: string; name: string } | null;
  readOnly?: boolean;
};
