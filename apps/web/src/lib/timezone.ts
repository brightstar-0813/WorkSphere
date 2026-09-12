/** Curated IANA zones for the picker (offset label is computed live). */
export const TIME_ZONE_OPTIONS: { id: string; label: string }[] = [
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { id: "America/Denver", label: "Mountain Time (US & Canada)" },
  { id: "America/Phoenix", label: "Arizona" },
  { id: "America/Chicago", label: "Central Time (US & Canada)" },
  { id: "America/New_York", label: "Eastern Time (US & Canada)" },
  { id: "America/Halifax", label: "Atlantic Time (Canada)" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Atlantic/Reykjavik", label: "Reykjavik" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Dublin", label: "Dublin" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Madrid", label: "Madrid" },
  { id: "Europe/Rome", label: "Rome" },
  { id: "Europe/Amsterdam", label: "Amsterdam" },
  { id: "Europe/Warsaw", label: "Warsaw" },
  { id: "Europe/Athens", label: "Athens" },
  { id: "Europe/Bucharest", label: "Bucharest" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Africa/Cairo", label: "Cairo" },
  { id: "Africa/Johannesburg", label: "Johannesburg" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "India" },
  { id: "Asia/Dhaka", label: "Dhaka" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Jakarta", label: "Jakarta" },
  { id: "Asia/Shanghai", label: "China" },
  { id: "Asia/Hong_Kong", label: "Hong Kong" },
  { id: "Asia/Taipei", label: "Taipei" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Manila", label: "Manila" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Perth", label: "Perth" },
  { id: "Australia/Adelaide", label: "Adelaide" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
  { id: "UTC", label: "UTC" },
];

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Google Calendar–style label: GMT+09, GMT-05, GMT+05:30 */
export function formatGmtOffset(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  if (raw === "GMT" || raw === "UTC") return "GMT+00";

  const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) {
    const short = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const s = short.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m2 = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
    if (!m2) return s.replace(/^UTC/, "GMT");
    const sign = m2[1];
    const hh = m2[2].padStart(2, "0");
    const mm = m2[3] && m2[3] !== "00" ? `:${m2[3]}` : "";
    return `GMT${sign}${hh}${mm}`;
  }
  const sign = match[1];
  const hh = match[2].padStart(2, "0");
  const mm = match[3] && match[3] !== "00" ? `:${match[3]}` : "";
  return `GMT${sign}${hh}${mm}`;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Civil wall-clock in `timeZone` → absolute UTC Date. */
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  if (timeZone === "UTC") {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }
  let utcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(new Date(utcMillis), timeZone);
    const shownAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = targetAsUtc - shownAsUtc;
    if (delta === 0) break;
    utcMillis += delta;
  }
  return new Date(utcMillis);
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return wallTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

export function endOfZonedDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return wallTimeToUtc(p.year, p.month, p.day, 23, 59, 59, timeZone);
}

/** Add civil days in the given zone (noon anchor avoids DST edge issues). */
export function addZonedDays(date: Date, days: number, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  const noon = wallTimeToUtc(p.year, p.month, p.day, 12, 0, 0, timeZone);
  const shifted = new Date(noon.getTime() + days * 86400000);
  return startOfZonedDay(shifted, timeZone);
}

export function startOfZonedWeek(date: Date, timeZone: string): Date {
  const start = startOfZonedDay(date, timeZone);
  // getDay() in local browser is wrong — use zone weekday via formatter
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(start);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = map[weekday] ?? 0;
  return addZonedDays(start, -dow, timeZone);
}

export function startOfZonedMonth(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return wallTimeToUtc(p.year, p.month, 1, 0, 0, 0, timeZone);
}

export function sameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

export function zonedDayNumber(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).day;
}

export function zonedMonthIndex(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).month - 1;
}

export function toZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const p = zonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function toZonedDateInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const p = zonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function fromZonedInput(value: string, timeZone: string): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4] ?? "0");
  const mi = Number(m[5] ?? "0");
  const s = Number(m[6] ?? "0");
  return wallTimeToUtc(y, mo, d, h, mi, s, timeZone).toISOString();
}

export function formatZonedMonthYear(date: Date, locale: string, timeZone: string): string {
  return date.toLocaleDateString(locale, { month: "long", year: "numeric", timeZone });
}

export function formatZonedDayHeader(date: Date, locale: string, timeZone: string): string {
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

export function formatZonedWeekday(date: Date, locale: string, timeZone: string): string {
  return date.toLocaleDateString(locale, { weekday: "short", timeZone });
}

export function formatZonedTime(
  iso: string,
  locale: string,
  timeZone: string,
  opts?: Intl.DateTimeFormatOptions
): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    ...opts,
  });
}

export function eventOccursOnZonedDay(
  event: { startsAt: string; endsAt?: string | null; allDay?: boolean },
  day: Date,
  timeZone: string
): boolean {
  const dayStart = startOfZonedDay(day, timeZone);
  const dayEnd = addZonedDays(dayStart, 1, timeZone);
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;

  if (event.allDay) {
    const rangeStart = startOfZonedDay(start, timeZone);
    let rangeEndExclusive: Date;
    if (!end) {
      rangeEndExclusive = addZonedDays(rangeStart, 1, timeZone);
    } else {
      const endDay = startOfZonedDay(end, timeZone);
      rangeEndExclusive = end.getTime() === endDay.getTime() ? endDay : addZonedDays(endDay, 1, timeZone);
    }
    return rangeStart < dayEnd && rangeEndExclusive > dayStart;
  }

  const rangeEnd = end ?? new Date(start.getTime() + 60 * 60 * 1000);
  return start < dayEnd && rangeEnd > dayStart;
}

export function zonedHourOffsetPx(date: Date, timeZone: string, hourPx: number): number {
  const p = zonedParts(date, timeZone);
  return (p.hour + p.minute / 60 + p.second / 3600) * hourPx;
}

export function zoneOptionLabel(timeZone: string, at: Date = new Date()): string {
  const known = TIME_ZONE_OPTIONS.find((z) => z.id === timeZone);
  const gmt = formatGmtOffset(timeZone, at);
  if (known) return `(${gmt}) ${known.label}`;
  return `(${gmt}) ${timeZone.replace(/_/g, " ")}`;
}
