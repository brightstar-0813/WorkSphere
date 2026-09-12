import { prisma } from "../prisma.js";
import { normalizeCalendarUrl, parseIcsEvents } from "./icsParse.js";

function isGoogleCalendarUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "calendar.google.com" || host.endsWith(".google.com");
  } catch {
    return false;
  }
}

function isGooglePublicIcs(url: string) {
  return /\/calendar\/ical\/[^/]+\/public\/basic\.ics/i.test(url);
}

function sourceTypeForUrl(url: string) {
  return isGoogleCalendarUrl(url) ? ("GOOGLE" as const) : ("OUTLOOK" as const);
}

const ICS_COLOR_PALETTE = [
  "#6366f1",
  "#ea4335",
  "#0078d4",
  "#059669",
  "#db2777",
  "#ca8a04",
  "#0e7490",
  "#7c3aed",
] as const;

function defaultLabelForUrl(url: string, label?: string) {
  const trimmed = label?.trim();
  if (trimmed && trimmed.length >= 2) return trimmed;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Calendar ICS";
  } catch {
    return "Calendar ICS";
  }
}

async function nextIcsColor(userId: string) {
  const count = await prisma.calendarIcsFeed.count({ where: { userId } });
  return ICS_COLOR_PALETTE[count % ICS_COLOR_PALETTE.length]!;
}

function fetchErrorMessage(url: string, status: number) {
  if (status === 404 && isGooglePublicIcs(url)) {
    return (
      "Google returned 404 for this public ICS link. In Google Calendar → Settings → Integrate calendar, " +
      "copy the Secret address in iCal format (private-…/basic.ics), or make the calendar public."
    );
  }
  if (status === 404 && isGoogleCalendarUrl(url)) {
    return (
      "Google returned 404 for this calendar URL. Use the Secret address in iCal format from " +
      "Google Calendar → Settings → Integrate calendar."
    );
  }
  return `Failed to fetch calendar URL (${status})`;
}

export async function syncIcsFeed(userId: string, feedId: string, from?: Date, to?: Date) {
  const feed = await prisma.calendarIcsFeed.findFirst({
    where: { id: feedId, userId },
  });
  if (!feed) throw new Error("ICS feed not found");

  const sourceType = sourceTypeForUrl(feed.url);
  const res = await fetch(feed.url, {
    headers: {
      Accept: "text/calendar, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (compatible; WorkSphere/1.0; +https://localhost) AppleWebKit/537.36",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(fetchErrorMessage(feed.url, res.status));
  }
  const raw = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(raw)) {
    throw new Error(
      "URL did not return an ICS calendar. Paste the secret/public .ics link, not a calendar web page."
    );
  }
  let events = parseIcsEvents(raw);

  if (from && to) {
    events = events.filter((ev) => {
      const end = ev.endsAt || ev.startsAt;
      return end >= from && ev.startsAt <= to;
    });
  }

  let upserted = 0;
  for (const ev of events) {
    const externalId = `${feed.id}:${ev.uid}`;
    await prisma.calendarEvent.upsert({
      where: {
        userId_sourceType_externalId: {
          userId,
          sourceType,
          externalId,
        },
      },
      create: {
        userId,
        title: ev.title,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        allDay: ev.allDay,
        description: ev.description,
        tag: "SCHEDULE",
        remindMinutes: 30,
        alertEnabled: true,
        recur: "ONCE",
        sourceType,
        sourceId: feed.id,
        externalId,
        htmlLink: feed.url,
      },
      update: {
        title: ev.title,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        allDay: ev.allDay,
        description: ev.description,
        htmlLink: feed.url,
      },
    });
    upserted += 1;
  }

  await prisma.calendarIcsFeed.update({
    where: { id: feed.id },
    data: { lastSyncAt: new Date() },
  });

  return upserted;
}

export async function syncAllIcsFeeds(userId: string, from?: Date, to?: Date) {
  const feeds = await prisma.calendarIcsFeed.findMany({ where: { userId } });
  const results: Record<string, number> = {};
  const errors: string[] = [];
  for (const feed of feeds) {
    try {
      results[feed.id] = await syncIcsFeed(userId, feed.id, from, to);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ICS sync failed";
      errors.push(`${feed.label || feed.id}: ${msg}`);
      results[feed.id] = 0;
    }
  }
  if (errors.length && Object.values(results).every((n) => n === 0) && feeds.length > 0) {
    throw new Error(errors[0]);
  }
  if (errors.length) {
    console.warn("[ics] partial sync failures", errors);
  }
  return results;
}

export async function addIcsFeed(userId: string, urlRaw: string, label?: string) {
  const url = normalizeCalendarUrl(urlRaw);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid calendar URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Calendar URL must be http(s) or webcal");
  }

  const color = await nextIcsColor(userId);
  const feed = await prisma.calendarIcsFeed.upsert({
    where: { userId_url: { userId, url } },
    create: {
      userId,
      url,
      label: defaultLabelForUrl(url, label),
      color,
    },
    update: {
      label: label?.trim() || undefined,
    },
  });

  const windowFrom = new Date();
  windowFrom.setMonth(windowFrom.getMonth() - 1);
  const windowTo = new Date();
  windowTo.setMonth(windowTo.getMonth() + 3);

  try {
    const synced = await syncIcsFeed(userId, feed.id, windowFrom, windowTo);
    return { feed, synced };
  } catch (err) {
    // Don't keep a feed that never synced successfully on first add
    await prisma.calendarEvent.deleteMany({
      where: { userId, sourceId: feed.id, sourceType: { in: ["GOOGLE", "OUTLOOK"] } },
    });
    await prisma.calendarIcsFeed.delete({ where: { id: feed.id } }).catch(() => undefined);
    throw err;
  }
}
