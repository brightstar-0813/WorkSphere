/** Map common Windows / Outlook TZIDs to IANA names for Intl. */
const WINDOWS_TO_IANA: Record<string, string> = {
  UTC: "UTC",
  GMT: "UTC",
  "UTC Standard Time": "UTC",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "GMT Standard Time": "Europe/London",
  "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indianapolis",
  "Central Standard Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "SA Western Standard Time": "America/La_Paz",
  "SA Pacific Standard Time": "America/Bogota",
  "SA Eastern Standard Time": "America/Cayenne",
  "Argentina Standard Time": "America/Buenos_Aires",
  "E. South America Standard Time": "America/Sao_Paulo",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Singapore Standard Time": "Asia/Singapore",
  "India Standard Time": "Asia/Kolkata",
  "SE Asia Standard Time": "Asia/Bangkok",
  "North Asia Standard Time": "Asia/Krasnoyarsk",
  "North Asia East Standard Time": "Asia/Irkutsk",
  "Russia Time Zone 3": "Europe/Samara",
  "Russian Standard Time": "Europe/Moscow",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Israel Standard Time": "Asia/Jerusalem",
  "Arabic Standard Time": "Asia/Baghdad",
  "Arab Standard Time": "Asia/Riyadh",
  "Iran Standard Time": "Asia/Tehran",
  "Arabian Standard Time": "Asia/Dubai",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "Tasmania Standard Time": "Australia/Hobart",
  "New Zealand Standard Time": "Pacific/Auckland",
  "Pacific SA Standard Time": "America/Santiago",
  "Canada Central Standard Time": "America/Regina",
  "Mexico Standard Time": "America/Mexico_City",
  "Libya Standard Time": "Africa/Tripoli",
  "Namibia Standard Time": "Africa/Windhoek",
  "Morocco Standard Time": "Africa/Casablanca",
};

export function resolveIanaTimeZone(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const cleaned = tzid.trim().replace(/^"|"$/g, "");
  if (!cleaned) return null;
  if (cleaned === "Z" || cleaned.toUpperCase() === "UTC") return "UTC";
  if (WINDOWS_TO_IANA[cleaned]) return WINDOWS_TO_IANA[cleaned];
  const lower = cleaned.toLowerCase();
  for (const [win, iana] of Object.entries(WINDOWS_TO_IANA)) {
    if (win.toLowerCase() === lower) return iana;
  }
  // Already IANA (e.g. America/New_York) — trust Intl
  try {
    Intl.DateTimeFormat(undefined, { timeZone: cleaned });
    return cleaned;
  } catch {
    return null;
  }
}

function readZoneParts(date: Date, timeZone: string) {
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

/**
 * Interpret a civil wall-clock time in `timeZone` as an absolute UTC Date.
 * Handles DST via Intl (Windows TZIDs must be mapped first).
 */
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
    const parts = readZoneParts(new Date(utcMillis), timeZone);
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
