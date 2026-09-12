import type { CalendarSourceType } from "@prisma/client";
import { prisma } from "./prisma.js";

type LinkedRef = {
  userId: string;
  sourceType: CalendarSourceType;
  sourceId: string;
};

type ScheduleInput = LinkedRef & {
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  description?: string;
  tag?: "DEADLINE" | "SCHEDULE";
  remindMinutes?: number;
  alertEnabled?: boolean;
  recur?: string;
  recurDays?: string;
  recurUntil?: Date | null;
};

/** Upsert only the deadline event for a Job (many other schedules can exist). */
export async function syncDeadlineEvent(
  input: LinkedRef & {
    title: string;
    startsAt: Date | null | undefined;
    description?: string;
  }
) {
  const { userId, sourceType, sourceId, title, startsAt, description } = input;

  const existing = await prisma.calendarEvent.findFirst({
    where: { userId, sourceType, sourceId, tag: "DEADLINE" },
  });

  if (!startsAt) {
    if (existing) await prisma.calendarEvent.delete({ where: { id: existing.id } });
    return null;
  }

  if (existing) {
    return prisma.calendarEvent.update({
      where: { id: existing.id },
      data: {
        title,
        startsAt,
        endsAt: null,
        allDay: true,
        description: description ?? "",
        tag: "DEADLINE",
        remindMinutes: 30,
        alertEnabled: true,
      },
    });
  }

  return prisma.calendarEvent.create({
    data: {
      userId,
      sourceType,
      sourceId,
      title,
      startsAt,
      endsAt: null,
      allDay: true,
      description: description ?? "",
      tag: "DEADLINE",
      remindMinutes: 30,
      alertEnabled: true,
    },
  });
}

/** Always create a new timed/all-day schedule linked to a job or hunting profile. */
export async function createScheduleEvent(input: ScheduleInput) {
  return prisma.calendarEvent.create({
    data: {
      userId: input.userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay ?? false,
      description: input.description ?? "",
      tag: input.tag ?? "SCHEDULE",
      remindMinutes: input.remindMinutes ?? 30,
      alertEnabled: input.alertEnabled ?? true,
      recur: input.recur ?? "ONCE",
      recurDays: input.recurDays ?? "",
      recurUntil: input.recurUntil ?? null,
    },
  });
}

export async function listLinkedSchedules(ref: LinkedRef) {
  return prisma.calendarEvent.findMany({
    where: {
      userId: ref.userId,
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
    },
    orderBy: { startsAt: "asc" },
  });
}

export async function deleteLinkedCalendarEvents(
  userId: string,
  sourceType: CalendarSourceType,
  sourceId: string
) {
  await prisma.calendarEvent.deleteMany({ where: { userId, sourceType, sourceId } });
}
