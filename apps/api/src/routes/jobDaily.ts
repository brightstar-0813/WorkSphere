import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { endOfDay, startOfDay } from "../dateUtils.js";
import { parseAnchorDate } from "../period.js";
import { resolveActorTimeZone } from "../requestTimeZone.js";
import { expandEventsInRange } from "../recur.js";

function parseDay(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function assertJobAccess(jobId: string, userId: string, role: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { error: "NOT_FOUND" as const };
  if (role !== "ADMIN" && job.userId !== userId) return { error: "FORBIDDEN" as const };
  return { job };
}

export function attachJobDailyRoutes(router: Router) {
  router.get("/:id/daily", async (req, res) => {
    const dayRaw = typeof req.query.date === "string" ? req.query.date : "";
    const day = parseDay(dayRaw);
    if (!day) {
      return res.status(400).json({
        error: { code: "VALIDATION", message: "Query date=YYYY-MM-DD required" },
      });
    }

    const access = await assertJobAccess(req.params.id, req.user!.id, req.user!.role);
    if ("error" in access && access.error === "NOT_FOUND") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    }
    if ("error" in access && access.error === "FORBIDDEN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }
    const job = access.job!;

    const log = await prisma.jobDayLog.upsert({
      where: { jobId_day: { jobId: job.id, day } },
      create: { jobId: job.id, userId: job.userId, day },
      update: {},
      include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });

    const timeZone = await resolveActorTimeZone(req, job.userId);
    const civil = parseAnchorDate(dayRaw, timeZone);
    const dayStart = startOfDay(civil, timeZone);
    const dayEnd = endOfDay(civil, timeZone);

    const stored = await prisma.calendarEvent.findMany({
      where: {
        userId: job.userId,
        sourceType: "JOB",
        sourceId: job.id,
        OR: [
          { recur: "ONCE", startsAt: { gte: dayStart, lte: dayEnd } },
          {
            NOT: { recur: "ONCE" },
            startsAt: { lte: dayEnd },
            OR: [{ recurUntil: null }, { recurUntil: { gte: dayStart } }],
          },
        ],
      },
      orderBy: { startsAt: "asc" },
    });

    const schedules = expandEventsInRange(stored, dayStart, dayEnd).map((ev) => ({
      ...ev,
      id: ev.occurrenceKey,
      seriesId: ev.seriesId,
      startsAt: ev.startsAt.toISOString(),
      endsAt: ev.endsAt ? ev.endsAt.toISOString() : null,
      recurUntil: ev.recurUntil ? ev.recurUntil.toISOString() : null,
    }));

    return res.json({
      data: {
        jobId: job.id,
        date: dayRaw,
        logId: log.id,
        items: log.items,
        schedules,
      },
    });
  });

  router.post("/:id/daily/items", async (req, res) => {
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const access = await assertJobAccess(req.params.id, req.user!.id, req.user!.role);
    if ("error" in access && access.error === "NOT_FOUND") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    }
    if ("error" in access && access.error === "FORBIDDEN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }
    const job = access.job!;
    const day = parseDay(parsed.data.date)!;

    const log = await prisma.jobDayLog.upsert({
      where: { jobId_day: { jobId: job.id, day } },
      create: { jobId: job.id, userId: job.userId, day },
      update: {},
    });

    const count = await prisma.jobDayItem.count({ where: { logId: log.id } });
    const data = await prisma.jobDayItem.create({
      data: {
        logId: log.id,
        title: parsed.data.title.trim(),
        description: (parsed.data.description ?? "").trim(),
        sortOrder: count,
        status: "TODO",
      },
    });

    return res.status(201).json({ data });
  });

  router.patch("/:id/daily/items/:itemId", async (req, res) => {
    const schema = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      status: z
        .enum(["TODO", "IN_PROGRESS", "DONE", "FAILED", "BACKLOG", "OVERDUE"])
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const access = await assertJobAccess(req.params.id, req.user!.id, req.user!.role);
    if ("error" in access && access.error === "NOT_FOUND") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    }
    if ("error" in access && access.error === "FORBIDDEN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }

    const item = await prisma.jobDayItem.findUnique({
      where: { id: req.params.itemId },
      include: { log: true },
    });
    if (!item || item.log.jobId !== req.params.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Item not found" } });
    }

    const data = await prisma.jobDayItem.update({
      where: { id: item.id },
      data: {
        title: parsed.data.title?.trim(),
        description:
          parsed.data.description === undefined
            ? undefined
            : parsed.data.description.trim(),
        status: parsed.data.status,
      },
    });
    return res.json({ data });
  });

  router.delete("/:id/daily/items/:itemId", async (req, res) => {
    const access = await assertJobAccess(req.params.id, req.user!.id, req.user!.role);
    if ("error" in access && access.error === "NOT_FOUND") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
    }
    if ("error" in access && access.error === "FORBIDDEN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }

    const item = await prisma.jobDayItem.findUnique({
      where: { id: req.params.itemId },
      include: { log: true },
    });
    if (!item || item.log.jobId !== req.params.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Item not found" } });
    }

    await prisma.jobDayItem.delete({ where: { id: item.id } });
    return res.status(204).send();
  });
}
