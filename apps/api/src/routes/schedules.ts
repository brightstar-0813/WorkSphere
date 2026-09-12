import { Router } from "express";
import { z } from "zod";
import type { CalendarSourceType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { createScheduleEvent, listLinkedSchedules } from "../calendarSync.js";
import { RECUR_FREQUENCIES, serializeRecurDays } from "../recur.js";

const scheduleBody = z.object({
  title: z.string().min(1).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  description: z.string().optional(),
  remindMinutes: z.number().int().min(0).max(10080).optional(),
  alertEnabled: z.boolean().optional(),
  recur: z.enum(RECUR_FREQUENCIES).optional(),
  recurDays: z.array(z.number().int().min(0).max(6)).optional(),
  recurUntil: z.string().datetime().nullable().optional(),
});

async function loadParent(
  sourceType: CalendarSourceType,
  id: string,
  userId: string,
  role: string
) {
  if (sourceType === "JOB") {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return null;
    if (role !== "ADMIN" && job.userId !== userId) return "FORBIDDEN" as const;
    return job;
  }
  const hunting = await prisma.huntingInterview.findUnique({ where: { id } });
  if (!hunting) return null;
  if (role !== "ADMIN" && hunting.userId !== userId) return "FORBIDDEN" as const;
  return hunting;
}

function defaultTitle(sourceType: CalendarSourceType) {
  if (sourceType === "JOB") return "Schedule";
  return "Interview";
}

export function attachScheduleRoutes(
  router: Router,
  sourceType: Extract<CalendarSourceType, "JOB" | "HUNTING">
) {
  router.get("/:id/schedules", async (req, res) => {
    const parent = await loadParent(sourceType, req.params.id, req.user!.id, req.user!.role);
    if (parent === null) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    }
    if (parent === "FORBIDDEN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }
    const data = await listLinkedSchedules({
      userId: parent.userId,
      sourceType,
      sourceId: req.params.id,
    });
    return res.json({ data });
  });

  router.post("/:id/schedules", async (req, res) => {
    const parent = await loadParent(sourceType, req.params.id, req.user!.id, req.user!.role);
    if (parent === null) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    }
    if (parent === "FORBIDDEN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }
    const parsed = scheduleBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const startsAt = new Date(parsed.data.startsAt);
    let endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
    if (!endsAt && !parsed.data.allDay) {
      endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    }

    const recur = parsed.data.recur ?? "ONCE";
    const recurDays =
      recur === "CUSTOM" ? serializeRecurDays(parsed.data.recurDays ?? []) : "";
    if (recur === "CUSTOM" && !recurDays) {
      return res.status(400).json({
        error: { code: "VALIDATION", message: "Custom repeat requires at least one weekday" },
      });
    }

    const data = await createScheduleEvent({
      userId: parent.userId,
      sourceType,
      sourceId: req.params.id,
      title: parsed.data.title?.trim() || defaultTitle(sourceType),
      startsAt,
      endsAt,
      allDay: parsed.data.allDay ?? false,
      description: parsed.data.description ?? "",
      tag: "SCHEDULE",
      remindMinutes: parsed.data.remindMinutes ?? 30,
      alertEnabled: parsed.data.alertEnabled ?? true,
      recur,
      recurDays,
      recurUntil: parsed.data.recurUntil ? new Date(parsed.data.recurUntil) : null,
    });

    return res.status(201).json({ data });
  });
}
