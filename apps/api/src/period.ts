import { wallTimeToUtc } from "./integrations/tzWallTime.js";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "./timeZone.js";

export type PeriodType = "daily" | "weekly" | "monthly";

export { DEFAULT_TIME_ZONE };

function zonedParts(date: Date, timeZone: string) {
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
  };
}

/** Start of civil day in the project/default timezone (UTC+9 / Asia/Tokyo unless overridden). */
export function startOfZonedDay(d: Date, timeZone: string = DEFAULT_TIME_ZONE) {
  const p = zonedParts(d, normalizeTimeZone(timeZone));
  return wallTimeToUtc(p.year, p.month, p.day, 0, 0, 0, normalizeTimeZone(timeZone));
}

export function addZonedDays(d: Date, n: number, timeZone: string = DEFAULT_TIME_ZONE) {
  const tz = normalizeTimeZone(timeZone);
  const p = zonedParts(d, tz);
  const noon = wallTimeToUtc(p.year, p.month, p.day, 12, 0, 0, tz);
  const shifted = new Date(noon.getTime() + n * 86400000);
  return startOfZonedDay(shifted, tz);
}

/** @deprecated use startOfZonedDay — kept for call sites expecting local naming */
export function startOfLocalDay(d: Date) {
  return startOfZonedDay(d, DEFAULT_TIME_ZONE);
}

export function addDays(d: Date, n: number) {
  return addZonedDays(d, n, DEFAULT_TIME_ZONE);
}

export function parseAnchorDate(raw: unknown, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const tz = normalizeTimeZone(timeZone);
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, day] = raw.split("-").map(Number);
    return wallTimeToUtc(y, m, day, 0, 0, 0, tz);
  }
  return startOfZonedDay(new Date(), tz);
}

export function parsePeriod(raw: unknown): PeriodType {
  if (raw === "daily" || raw === "day") return "daily";
  if (raw === "monthly" || raw === "month") return "monthly";
  if (raw === "weekly" || raw === "week") return "weekly";
  return "weekly";
}

export function resolvePeriod(
  period: PeriodType,
  anchor: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): { from: Date; to: Date } {
  const tz = normalizeTimeZone(timeZone);
  const dayStart = startOfZonedDay(anchor, tz);
  if (period === "daily") {
    return { from: dayStart, to: addZonedDays(dayStart, 1, tz) };
  }
  if (period === "weekly") {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(dayStart);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = map[weekday] ?? 0;
    const weekStart = addZonedDays(dayStart, -dow, tz);
    return { from: weekStart, to: addZonedDays(weekStart, 7, tz) };
  }
  const p = zonedParts(dayStart, tz);
  const monthStart = wallTimeToUtc(p.year, p.month, 1, 0, 0, 0, tz);
  const nextMonth =
    p.month === 12
      ? wallTimeToUtc(p.year + 1, 1, 1, 0, 0, 0, tz)
      : wallTimeToUtc(p.year, p.month + 1, 1, 0, 0, 0, tz);
  return { from: monthStart, to: nextMonth };
}

export function formatAnchorKey(anchor: Date, timeZone: string = DEFAULT_TIME_ZONE) {
  const p = zonedParts(anchor, normalizeTimeZone(timeZone));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function bidDateFilter(range: { gte: Date; lt: Date }) {
  return {
    OR: [
      { appliedAt: range },
      { AND: [{ appliedAt: null }, { createdAt: range }] },
      { AND: [{ appliedAt: null }, { updatedAt: range }] },
    ],
  };
}

/** Interviews with a schedule time — constrained to a period. */
export function interviewDateFilter(range: { gte: Date; lt: Date }) {
  return { scheduledAt: range };
}

/**
 * Hunting Interview Tracking list filter.
 * Daily/Weekly/Monthly only include rows with a schedule in range.
 */
export function interviewListDateFilter(range: { gte: Date; lt: Date }) {
  return { scheduledAt: range };
}
