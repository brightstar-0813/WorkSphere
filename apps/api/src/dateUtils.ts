import { addZonedDays, startOfZonedDay } from "./period.js";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "./timeZone.js";

/** Start of civil day in the given IANA zone (default Asia/Tokyo). */
export function startOfDay(d: Date, timeZone: string = DEFAULT_TIME_ZONE) {
  return startOfZonedDay(d, normalizeTimeZone(timeZone));
}

/** Inclusive end of civil day in the given IANA zone. */
export function endOfDay(d: Date, timeZone: string = DEFAULT_TIME_ZONE) {
  const tz = normalizeTimeZone(timeZone);
  const next = addZonedDays(startOfZonedDay(d, tz), 1, tz);
  return new Date(next.getTime() - 1);
}
