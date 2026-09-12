import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { deleteLinkedCalendarEvents, syncDeadlineEvent } from "../calendarSync.js";
import { attachScheduleRoutes } from "./schedules.js";
import { attachJobDailyRoutes } from "./jobDaily.js";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const jobBody = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  description: z.string().optional(),
});

jobsRouter.get("/", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const data = await prisma.job.findMany({ where, orderBy: { updatedAt: "desc" } });
  return res.json({ data });
});

jobsRouter.post("/", async (req, res) => {
  const parsed = jobBody.extend({ title: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.job.create({
    data: {
      userId: req.user!.id,
      title: parsed.data.title,
      status: parsed.data.status,
      priority: parsed.data.priority,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      description: parsed.data.description ?? "",
    },
  });

  await syncDeadlineEvent({
    userId: data.userId,
    sourceType: "JOB",
    sourceId: data.id,
    title: `Deadline: ${data.title}`,
    startsAt: data.dueAt,
    description: data.description,
  });

  return res.status(201).json({ data });
});

jobsRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your job" } });
  }
  const parsed = jobBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.job.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      dueAt:
        parsed.data.dueAt === undefined
          ? undefined
          : parsed.data.dueAt
            ? new Date(parsed.data.dueAt)
            : null,
    },
  });

  if (parsed.data.dueAt !== undefined || parsed.data.title !== undefined) {
    await syncDeadlineEvent({
      userId: data.userId,
      sourceType: "JOB",
      sourceId: data.id,
      title: `Deadline: ${data.title}`,
      startsAt: data.dueAt,
      description: data.description,
    });
  }

  return res.json({ data });
});

jobsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your job" } });
  }
  await deleteLinkedCalendarEvents(existing.userId, "JOB", existing.id);
  await prisma.job.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

attachJobDailyRoutes(jobsRouter);
attachScheduleRoutes(jobsRouter, "JOB");
