import { resolveIanaTimeZone, wallTimeToUtc } from "./tzWallTime.js";

export type ParsedIcsEvent = {
  uid: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
};

function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function tzidFromParams(params: string): string | null {
  const match = params.match(/TZID=([^;]+)/i);
  if (!match) return null;
  return match[1].trim().replace(/^"|"$/g, "");
}

/** Parse ICS date: YYYYMMDD or YYYYMMDDTHHMMSS(Z) with optional TZID. */
function parseIcsDate(value: string, params: string): { date: Date; allDay: boolean } | null {
  const v = value.trim();
  const paramsUpper = params.toUpperCase();
  const allDay = paramsUpper.includes("VALUE=DATE") || (/^\d{8}$/.test(v) && !v.includes("T"));
  if (allDay) {
    const day = v.slice(0, 8);
    if (!/^\d{8}$/.test(day)) return null;
    const y = Number(day.slice(0, 4));
    const m = Number(day.slice(4, 6)) - 1;
    const d = Number(day.slice(6, 8));
    return { date: new Date(Date.UTC(y, m, d, 0, 0, 0)), allDay: true };
  }

  const match = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
  if (!match) return null;
  const [, ys, ms, ds, hs, mins, ss, z] = match;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const h = Number(hs);
  const mi = Number(mins);
  const s = Number(ss);

  if (z) {
    return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  }

  const iana = resolveIanaTimeZone(tzidFromParams(params));
  if (iana) {
    return { date: wallTimeToUtc(y, mo, d, h, mi, s, iana), allDay: false };
  }

  // Floating local time with unknown zone — keep prior behavior (treat as UTC)
  return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
}

function propParts(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(";");
  // Keep TZID values case-sensitive (Windows IDs like "Eastern Standard Time")
  const params = paramParts
    .map((p) => {
      const eq = p.indexOf("=");
      if (eq < 0) return p.toUpperCase();
      const key = p.slice(0, eq).toUpperCase();
      const val = p.slice(eq + 1);
      return `${key}=${val}`;
    })
    .join(";");
  return {
    name: (name || "").toUpperCase(),
    params,
    value,
  };
}

export function parseIcsEvents(raw: string): ParsedIcsEvent[] {
  const text = unfoldIcs(raw);
  const lines = text.split("\n");
  const events: ParsedIcsEvent[] = [];
  let inEvent = false;
  let uid = "";
  let title = "";
  let description = "";
  let starts: { date: Date; allDay: boolean } | null = null;
  let ends: { date: Date; allDay: boolean } | null = null;

  function flush() {
    if (!uid || !starts) return;
    events.push({
      uid,
      title: title || "(No title)",
      description,
      startsAt: starts.date,
      endsAt: ends?.date ?? null,
      allDay: starts.allDay,
    });
  }

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      uid = "";
      title = "";
      description = "";
      starts = null;
      ends = null;
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (inEvent) flush();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    const prop = propParts(trimmed);
    if (!prop) continue;
    if (prop.name === "UID") uid = unescapeIcs(prop.value).trim();
    else if (prop.name === "SUMMARY") title = unescapeIcs(prop.value).trim();
    else if (prop.name === "DESCRIPTION") description = unescapeIcs(prop.value).trim();
    else if (prop.name === "DTSTART") starts = parseIcsDate(prop.value, prop.params);
    else if (prop.name === "DTEND") ends = parseIcsDate(prop.value, prop.params);
  }

  return events;
}

export function normalizeCalendarUrl(input: string): string {
  let url = input.trim();
  if (url.toLowerCase().startsWith("webcal://")) {
    url = `https://${url.slice("webcal://".length)}`;
  }
  return url;
}
