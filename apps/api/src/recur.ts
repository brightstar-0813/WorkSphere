export type RecurFrequency =
  | "ONCE"
  | "DAILY"
  | "WEEKDAYS"
  | "WEEKLY"
  | "MONTHLY"
  | "CUSTOM";

export const RECUR_FREQUENCIES = [
  "ONCE",
  "DAILY",
  "WEEKDAYS",
  "WEEKLY",
  "MONTHLY",
  "CUSTOM",
] as const satisfies readonly RecurFrequency[];

export type RecurringEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  description: string;
  tag: string;
  remindMinutes: number;
  alertEnabled: boolean;
  recur: string;
  /** Comma-separated JS weekdays 0–6 when recur is CUSTOM */
  recurDays?: string | null;
  recurUntil: Date | null;
  sourceType: string;
  sourceId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  userId?: string;
};

/** Parse stored weekday list (0=Sun … 6=Sat). */
export function parseRecurDays(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [];
  const days = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function serializeRecurDays(days: number[]): string {
  return [...new Set(days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
    .sort((a, b) => a - b)
    .join(",");
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function occursOnDay(event: RecurringEvent, day: Date): boolean {
  const dayStart = startOfLocalDay(day);
  const seriesStart = startOfLocalDay(event.startsAt);
  if (dayStart < seriesStart) return false;
  if (event.recurUntil) {
    const until = startOfLocalDay(event.recurUntil);
    if (dayStart > until) return false;
  }

  const freq = (event.recur || "ONCE") as RecurFrequency;
  if (freq === "ONCE") return sameLocalDay(event.startsAt, day);

  const dow = dayStart.getDay();
  switch (freq) {
    case "DAILY":
      return true;
    case "WEEKDAYS":
      return dow >= 1 && dow <= 5;
    case "WEEKLY":
      return dow === event.startsAt.getDay();
    case "MONTHLY":
      return dayStart.getDate() === event.startsAt.getDate();
    case "CUSTOM": {
      const days = parseRecurDays(event.recurDays);
      if (days.length === 0) return false;
      return days.includes(dow);
    }
    default:
      return sameLocalDay(event.startsAt, day);
  }
}

function occurrenceTimes(event: RecurringEvent, day: Date) {
  const startsAt = new Date(day);
  startsAt.setHours(
    event.startsAt.getHours(),
    event.startsAt.getMinutes(),
    event.startsAt.getSeconds(),
    event.startsAt.getMilliseconds()
  );

  let endsAt: Date | null = null;
  if (event.endsAt) {
    const dur = event.endsAt.getTime() - event.startsAt.getTime();
    endsAt = new Date(startsAt.getTime() + Math.max(0, dur));
  } else if (event.allDay) {
    endsAt = null;
  }

  return { startsAt, endsAt };
}

/** Expand stored events into concrete occurrences within [from, to]. */
export function expandEventsInRange<T extends RecurringEvent>(
  events: T[],
  from: Date,
  to: Date
): Array<
  Omit<T, "startsAt" | "endsAt"> & {
    startsAt: Date;
    endsAt: Date | null;
    seriesId: string;
    occurrenceKey: string;
  }
> {
  const out: Array<
    Omit<T, "startsAt" | "endsAt"> & {
      startsAt: Date;
      endsAt: Date | null;
      seriesId: string;
      occurrenceKey: string;
    }
  > = [];

  const rangeStart = startOfLocalDay(from);
  const rangeEnd = startOfLocalDay(to);

  for (const event of events) {
    const freq = (event.recur || "ONCE") as RecurFrequency;
    if (freq === "ONCE") {
      if (event.startsAt >= from && event.startsAt <= to) {
        out.push({
          ...event,
          seriesId: event.id,
          occurrenceKey: event.id,
        });
      }
      continue;
    }

    for (let cursor = rangeStart; cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
      if (!occursOnDay(event, cursor)) continue;
      const { startsAt, endsAt } = occurrenceTimes(event, cursor);
      if (startsAt > to || (endsAt ?? startsAt) < from) {
        // still include if the occurrence day intersects the query window loosely
        if (startsAt < from && (!endsAt || endsAt < from)) continue;
        if (startsAt > to) continue;
      }
      const key = `${event.id}:${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`;
      out.push({
        ...event,
        startsAt,
        endsAt,
        seriesId: event.id,
        occurrenceKey: key,
      });
    }
  }

  out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return out;
}

export function serializeOccurrence<T extends { startsAt: Date; endsAt: Date | null; recurUntil?: Date | null }>(
  ev: T
) {
  return {
    ...ev,
    startsAt: ev.startsAt.toISOString(),
    endsAt: ev.endsAt ? ev.endsAt.toISOString() : null,
    recurUntil: ev.recurUntil ? ev.recurUntil.toISOString() : null,
  };
}
