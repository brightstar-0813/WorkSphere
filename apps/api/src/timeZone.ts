/** Project default: Japan Standard Time (UTC+9). No DST. */
export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export function normalizeTimeZone(raw: string | null | undefined): string {
  const tz = String(raw || "").trim();
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
