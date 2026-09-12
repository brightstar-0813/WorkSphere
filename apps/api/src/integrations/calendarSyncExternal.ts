import type { CalendarProvider, CalendarSourceType } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  createGoogleEvent,
  createOutlookEvent,
  listGoogleEvents,
  listOutlookEvents,
  type ExternalEvent,
} from "./calendarProviders.js";

function sourceFor(provider: CalendarProvider): CalendarSourceType {
  return provider === "GOOGLE" ? "GOOGLE" : "OUTLOOK";
}

async function mirrorEvents(
  userId: string,
  provider: CalendarProvider,
  events: ExternalEvent[],
  connectionIds: string[]
) {
  const sourceType = sourceFor(provider);
  let upserted = 0;
  for (const ev of events) {
    await prisma.calendarEvent.upsert({
      where: {
        userId_sourceType_externalId: {
          userId,
          sourceType,
          externalId: ev.externalId,
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
        sourceId: ev.connectionId || null,
        externalId: ev.externalId,
        attendees: ev.attendees.join(","),
        htmlLink: ev.htmlLink || null,
      },
      update: {
        title: ev.title,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        allDay: ev.allDay,
        description: ev.description,
        sourceId: ev.connectionId || null,
        attendees: ev.attendees.join(","),
        htmlLink: ev.htmlLink || null,
      },
    });
    upserted += 1;
  }

  if (connectionIds.length > 0) {
    await prisma.calendarConnection.updateMany({
      where: { id: { in: connectionIds }, userId },
      data: { lastSyncAt: new Date() },
    });
  }

  return upserted;
}

export async function syncExternalCalendar(
  userId: string,
  provider: CalendarProvider,
  from: Date,
  to: Date,
  connectionId?: string
) {
  const events =
    provider === "GOOGLE"
      ? await listGoogleEvents(userId, from, to, connectionId)
      : await listOutlookEvents(userId, from, to, connectionId);

  const connectionIds = [
    ...new Set(
      events
        .map((e) => e.connectionId)
        .filter((id): id is string => Boolean(id))
        .concat(connectionId ? [connectionId] : [])
    ),
  ];

  // If a specific connection was synced but had zero events, still stamp lastSyncAt
  if (connectionId && !connectionIds.includes(connectionId)) {
    connectionIds.push(connectionId);
  }

  return mirrorEvents(userId, provider, events, connectionIds);
}

export async function pushInviteToConnectedCalendars(
  userId: string,
  input: {
    title: string;
    description?: string;
    startsAt: Date;
    endsAt: Date | null;
    allDay?: boolean;
    attendees?: string[];
    prefer?: CalendarProvider | "AUTO";
    connectionId?: string;
  }
) {
  const attendees = input.attendees || [];
  if (attendees.length === 0 && input.prefer === undefined) {
    return null;
  }

  const prefer = input.prefer || "AUTO";
  if (prefer === "GOOGLE" || prefer === "AUTO") {
    try {
      const created = await createGoogleEvent(userId, {
        ...input,
        attendees,
        connectionId: input.connectionId,
      });
      if (created) {
        return { provider: "GOOGLE" as const, ...created };
      }
    } catch (err) {
      if (prefer === "GOOGLE") throw err;
    }
  }
  if (prefer === "OUTLOOK" || prefer === "AUTO") {
    try {
      const created = await createOutlookEvent(userId, {
        ...input,
        attendees,
        connectionId: input.connectionId,
      });
      if (created) {
        return { provider: "OUTLOOK" as const, ...created };
      }
    } catch (err) {
      if (prefer === "OUTLOOK") throw err;
    }
  }
  return null;
}
