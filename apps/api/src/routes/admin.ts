import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAdmin, requireAuth } from "../auth.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/overview", async (_req, res) => {
  const [users, events, jobs, huntings, interviews, transactions, jobsByStatus, bidsByStatus, interviewsByStatus] =
    await Promise.all([
      prisma.user.count(),
      prisma.calendarEvent.count(),
      prisma.job.count(),
      prisma.huntingBid.count(),
      prisma.huntingInterview.count(),
      prisma.transaction.count(),
      prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.huntingBid.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.huntingInterview.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
  return res.json({
    data: {
      users,
      events,
      jobs,
      huntings,
      interviews,
      transactions,
      jobsByStatus: Object.fromEntries(jobsByStatus.map((r) => [r.status, r._count._all])),
      bidsByStatus: Object.fromEntries(bidsByStatus.map((r) => [r.status, r._count._all])),
      interviewsByStatus: Object.fromEntries(interviewsByStatus.map((r) => [r.status, r._count._all])),
      /** @deprecated use bidsByStatus */
      huntingsByStage: Object.fromEntries(bidsByStatus.map((r) => [r.status, r._count._all])),
    },
  });
});

adminRouter.get("/events", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

  const data = await prisma.calendarEvent.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(from || to
        ? {
            startsAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 2000,
  });
  return res.json({ data });
});

adminRouter.get("/jobs", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const statusParsed = z
    .enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"])
    .safeParse(req.query.status);
  const data = await prisma.job.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(statusParsed.success ? { status: statusParsed.data } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      _count: { select: { dayLogs: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return res.json({ data });
});

adminRouter.get("/jobs/:id", async (req, res) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      dayLogs: {
        orderBy: { day: "desc" },
        take: 30,
        include: {
          items: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!job) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found" } });
  }
  return res.json({ data: job });
});

adminRouter.get("/huntings", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const statusParsed = z
    .enum(["DRAFT", "SENT", "SHORTLISTED", "REJECTED", "WITHDRAWN", "WON"])
    .safeParse(req.query.status ?? req.query.stage);
  const data = await prisma.huntingBid.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(statusParsed.success ? { status: statusParsed.data } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      profile: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return res.json({ data });
});

adminRouter.get("/interviews", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const statusParsed = z
    .enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"])
    .safeParse(req.query.status);
  const data = await prisma.huntingInterview.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(statusParsed.success ? { status: statusParsed.data } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      profile: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return res.json({ data });
});

adminRouter.get("/transactions", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const typeParsed = z.enum(["INCOME", "EXPENSE"]).safeParse(req.query.type);
  const data = await prisma.transaction.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(typeParsed.success ? { type: typeParsed.data } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });
  return res.json({ data });
});

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      disabled: true,
      createdAt: true,
      _count: {
        select: {
          jobs: true,
          huntingBids: true,
          huntingInterviews: true,
          transactions: true,
          discussions: true,
          events: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ data: users });
});

adminRouter.post("/users", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(6),
    role: z.enum(["USER", "ADMIN"]).default("USER"),
    locale: z.enum(["en", "zh", "ru"]).default("en"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) {
    return res.status(409).json({ error: { code: "CONFLICT", message: "Email already exists" } });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const data = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      role: parsed.data.role,
      locale: parsed.data.locale,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      disabled: true,
      createdAt: true,
    },
  });
  return res.status(201).json({ data });
});

adminRouter.patch("/users/:id", async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.enum(["USER", "ADMIN"]).optional(),
    locale: z.enum(["en", "zh", "ru"]).optional(),
    disabled: z.boolean().optional(),
    password: z.string().min(6).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  }

  if (parsed.data.email && parsed.data.email !== existing.email) {
    const clash = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (clash) {
      return res.status(409).json({ error: { code: "CONFLICT", message: "Email already exists" } });
    }
  }

  // Prevent self-lockout: admin cannot disable/demote self
  if (req.user!.id === existing.id) {
    if (parsed.data.disabled === true) {
      return res.status(400).json({ error: { code: "VALIDATION", message: "Cannot disable yourself" } });
    }
    if (parsed.data.role === "USER") {
      return res.status(400).json({ error: { code: "VALIDATION", message: "Cannot demote yourself" } });
    }
  }

  const data = await prisma.user.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      locale: parsed.data.locale,
      disabled: parsed.data.disabled,
      passwordHash: parsed.data.password
        ? await bcrypt.hash(parsed.data.password, 10)
        : undefined,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      disabled: true,
      createdAt: true,
      _count: {
        select: {
          jobs: true,
          huntingBids: true,
          huntingInterviews: true,
          transactions: true,
          discussions: true,
          events: true,
        },
      },
    },
  });
  return res.json({ data });
});

adminRouter.delete("/users/:id", async (req, res) => {
  if (req.user!.id === req.params.id) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Cannot delete yourself" } });
  }
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  }
  await prisma.user.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

adminRouter.get("/users/:id", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      locale: true,
      avatarUrl: true,
      disabled: true,
      createdAt: true,
      jobs: {
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: {
          _count: { select: { dayLogs: true } },
          dayLogs: {
            orderBy: { day: "desc" },
            take: 5,
            include: { items: { orderBy: { sortOrder: "asc" }, take: 20 } },
          },
        },
      },
      huntingBids: {
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: { profile: { select: { id: true, name: true } } },
      },
      huntingInterviews: {
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: { profile: { select: { id: true, name: true } } },
      },
      transactions: { orderBy: { occurredAt: "desc" }, take: 100 },
      events: { orderBy: { startsAt: "desc" }, take: 200 },
      discussions: {
        include: { replies: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
        take: 50,
      },
    },
  });
  if (!user) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  }
  return res.json({ data: user });
});
