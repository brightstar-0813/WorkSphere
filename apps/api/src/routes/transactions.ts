import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { listMeta, parsePagination } from "../pagination.js";

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);

transactionsRouter.get("/", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);
  const [total, data] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({ where, orderBy: { occurredAt: "desc" }, skip, take }),
  ]);
  return res.json({ data, meta: listMeta(total, page, pageSize) });
});

transactionsRouter.post("/", async (req, res) => {
  const schema = z.object({
    type: z.enum(["INCOME", "EXPENSE"]),
    amountMinor: z.number().int().positive(),
    currency: z.string().min(3).max(3).optional(),
    category: z.string().min(1),
    occurredAt: z.string().datetime(),
    note: z.string().optional(),
    userId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  let userId = req.user!.id;
  if (parsed.data.userId && parsed.data.userId !== req.user!.id) {
    if (req.user!.role !== "ADMIN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }
    const target = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true },
    });
    if (!target) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
    }
    userId = target.id;
  }

  const data = await prisma.transaction.create({
    data: {
      userId,
      type: parsed.data.type,
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency ?? "USD",
      category: parsed.data.category,
      occurredAt: new Date(parsed.data.occurredAt),
      note: parsed.data.note ?? "",
    },
  });
  return res.status(201).json({ data });
});

transactionsRouter.patch("/:id", async (req, res) => {
  const schema = z.object({
    type: z.enum(["INCOME", "EXPENSE"]).optional(),
    amountMinor: z.number().int().positive().optional(),
    currency: z.string().min(3).max(3).optional(),
    category: z.string().min(1).optional(),
    occurredAt: z.string().datetime().optional(),
    note: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const existing = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }

  const data = await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      type: parsed.data.type,
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency,
      category: parsed.data.category,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
      note: parsed.data.note,
    },
  });
  return res.json({ data });
});

transactionsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  await prisma.transaction.delete({ where: { id: existing.id } });
  return res.status(204).send();
});
