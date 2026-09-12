import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);

transactionsRouter.get("/", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const data = await prisma.transaction.findMany({ where, orderBy: { occurredAt: "desc" } });
  return res.json({ data });
});

transactionsRouter.post("/", async (req, res) => {
  const schema = z.object({
    type: z.enum(["INCOME", "EXPENSE"]),
    amountMinor: z.number().int().positive(),
    currency: z.string().min(3).max(3).optional(),
    category: z.string().min(1),
    occurredAt: z.string().datetime(),
    note: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.transaction.create({
    data: {
      userId: req.user!.id,
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
