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

/** Count synced ICS feed events (imported calendars) — treated as hunting interview schedules. */
export async function countIcsScheduleEvents(opts: {
  userId?: string;
  feedId?: string;
  profileId?: string;
  startsAt?: { gte?: Date; lt?: Date };
  q?: string;
}) {
  const feeds = await prisma.calendarIcsFeed.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.feedId ? { id: opts.feedId } : {}),
      ...(opts.profileId ? { profileId: opts.profileId } : {}),
    },
    select: { id: true },
  });
  if (feeds.length === 0) return 0;
  const q = opts.q?.trim();
  return prisma.calendarEvent.count({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      sourceType: { in: ["GOOGLE", "OUTLOOK"] },
      sourceId: { in: feeds.map((f) => f.id) },
      ...(opts.startsAt ? { startsAt: opts.startsAt } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  });
}

export async function countIcsScheduleEventsByUser(opts: {
  userIds: string[];
  startsAt?: { gte?: Date; lt?: Date };
}) {
  if (opts.userIds.length === 0) return [] as Array<{ userId: string; count: number }>;
  const feeds = await prisma.calendarIcsFeed.findMany({
    where: { userId: { in: opts.userIds } },
    select: { id: true },
  });
  if (feeds.length === 0) return [] as Array<{ userId: string; count: number }>;
  const groups = await prisma.calendarEvent.groupBy({
    by: ["userId"],
    where: {
      userId: { in: opts.userIds },
      sourceType: { in: ["GOOGLE", "OUTLOOK"] },
      sourceId: { in: feeds.map((f) => f.id) },
      ...(opts.startsAt ? { startsAt: opts.startsAt } : {}),
    },
    _count: { _all: true },
  });
  return groups.map((g) => ({ userId: g.userId, count: g._count._all }));
}

/** List imported ICS calendar events as interview-schedule rows. */
export async function listIcsScheduleEvents(opts: {
  userId?: string;
  feedId?: string;
  /** Restrict to the ICS feed linked to this hunting profile */
  profileId?: string;
  startsAt?: { gte?: Date; lt?: Date };
  q?: string;
  skip?: number;
  take?: number;
}) {
  const feeds = await prisma.calendarIcsFeed.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.feedId ? { id: opts.feedId } : {}),
      ...(opts.profileId ? { profileId: opts.profileId } : {}),
    },
    select: { id: true, label: true, url: true, color: true, profileId: true },
  });
  if (feeds.length === 0) return [];
  const feedById = Object.fromEntries(feeds.map((f) => [f.id, f]));
  const q = opts.q?.trim();
  const events = await prisma.calendarEvent.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      sourceType: { in: ["GOOGLE", "OUTLOOK"] },
      sourceId: { in: feeds.map((f) => f.id) },
      ...(opts.startsAt ? { startsAt: opts.startsAt } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { startsAt: "asc" },
    skip: opts.skip,
    take: opts.take ?? 500,
  });
  return events.map((ev) => {
    const feed = ev.sourceId ? feedById[ev.sourceId] : undefined;
    return {
      id: ev.id,
      profileId: feed?.profileId || "",
      feedId: feed?.id || ev.sourceId || "",
      bidId: null as string | null,
      company: ev.title,
      roleTitle: feed?.label || ev.sourceType,
      status: "SCHEDULED" as const,
      notes: "",
      scheduledAt: ev.startsAt,
      scheduleEndsAt: ev.endsAt,
      updatedAt: ev.updatedAt,
      user: ev.user,
      profile: feed?.profileId
        ? { id: feed.profileId, name: feed.label }
        : feed
          ? { id: feed.id, name: feed.label }
          : undefined,
      source: "ICS" as const,
      sourceType: ev.sourceType,
      htmlLink: ev.htmlLink || feed?.url || null,
      readOnly: true as const,
    };
  });
}

/**
 * Ensure each ICS feed has a hunting profile so it appears in Bid Tracking.
 * Reuses an existing profile with the same name when possible.
 */
export async function ensureIcsFeedHuntingProfile(feed: {
  id: string;
  userId: string;
  label: string;
  profileId: string | null;
}) {
  if (feed.profileId) {
    const linked = await prisma.huntingProfile.findFirst({
      where: { id: feed.profileId, userId: feed.userId },
    });
    if (linked) return linked;
  }

  const name = (feed.label || "Calendar").trim() || "Calendar";
  const existing = await prisma.huntingProfile.findFirst({
    where: { userId: feed.userId, name },
    orderBy: { createdAt: "asc" },
  });
  let profile =
    existing ??
    (await prisma.huntingProfile.create({
      data: {
        userId: feed.userId,
        name,
        label: "",
        sheetTabName: name,
        active: true,
      },
    }));

  // Drop the old generic "Calendar" platform note from auto-linked profiles.
  if (/^calendar$/i.test(profile.label.trim())) {
    profile = await prisma.huntingProfile.update({
      where: { id: profile.id },
      data: { label: "" },
    });
  }

  if (feed.profileId !== profile.id) {
    await prisma.calendarIcsFeed.update({
      where: { id: feed.id },
      data: { profileId: profile.id },
    });
  }
  return profile;
}

/** Backfill hunting profiles for all ICS feeds missing a link. */
export async function ensureAllIcsFeedHuntingProfiles(userId?: string) {
  const feeds = await prisma.calendarIcsFeed.findMany({
    where: userId ? { userId } : undefined,
  });
  for (const feed of feeds) {
    await ensureIcsFeedHuntingProfile(feed);
  }
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
  const feedLabel = defaultLabelForUrl(url, label);
  let feed = await prisma.calendarIcsFeed.upsert({
    where: { userId_url: { userId, url } },
    create: {
      userId,
      url,
      label: feedLabel,
      color,
    },
    update: {
      label: label?.trim() || undefined,
    },
  });

  await ensureIcsFeedHuntingProfile(feed);
  feed = (await prisma.calendarIcsFeed.findUniqueOrThrow({ where: { id: feed.id } }))!;

  const windowFrom = new Date();
  windowFrom.setMonth(windowFrom.getMonth() - 1);
  const windowTo = new Date();
  windowTo.setMonth(windowTo.getMonth() + 3);

  try {
    const synced = await syncIcsFeed(userId, feed.id, windowFrom, windowTo);
    return { feed, synced };
  } catch (err) {
    // Don't keep a feed that never synced successfully on first add
    const orphanProfileId = feed.profileId;
    await prisma.calendarEvent.deleteMany({
      where: { userId, sourceId: feed.id, sourceType: { in: ["GOOGLE", "OUTLOOK"] } },
    });
    await prisma.calendarIcsFeed.delete({ where: { id: feed.id } }).catch(() => undefined);
    if (orphanProfileId) {
      const stillLinked = await prisma.calendarIcsFeed.findFirst({
        where: { profileId: orphanProfileId },
      });
      if (!stillLinked) {
        const bidCount = await prisma.huntingBid.count({ where: { profileId: orphanProfileId } });
        if (bidCount === 0) {
          await prisma.huntingProfile.delete({ where: { id: orphanProfileId } }).catch(() => undefined);
        }
      }
    }
    throw err;
  }
}
