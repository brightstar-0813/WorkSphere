export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocalDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  x.setDate(x.getDate() - day);
  return x;
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatMonthYear(d: Date, locale: string) {
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function formatDayHeader(d: Date, locale: string) {
  return d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
}

/** True if the event overlaps the local calendar day. End times at midnight are exclusive. */
export function eventOccursOnDay(
  event: { startsAt: string; endsAt?: string | null; allDay?: boolean },
  day: Date
) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;

  if (event.allDay) {
    const rangeStart = startOfDay(start);
    let rangeEndExclusive: Date;
    if (!end) {
      rangeEndExclusive = addDays(rangeStart, 1);
    } else {
      const endDay = startOfDay(end);
      // Midnight end → that calendar day is exclusive (ICS convention)
      rangeEndExclusive = end.getTime() === endDay.getTime() ? endDay : addDays(endDay, 1);
    }
    return rangeStart < dayEnd && rangeEndExclusive > dayStart;
  }

  const rangeEnd = end ?? new Date(start.getTime() + 60 * 60 * 1000);
  return start < dayEnd && rangeEnd > dayStart;
}
