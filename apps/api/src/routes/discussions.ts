import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { listMeta, parsePagination } from "../pagination.js";

export const discussionsRouter = Router();
discussionsRouter.use(requireAuth);

discussionsRouter.get("/", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);
  const [total, data] = await Promise.all([
    prisma.discussion.count({ where }),
    prisma.discussion.findMany({
      where,
      include: {
        replies: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
  ]);
  return res.json({ data, meta: listMeta(total, page, pageSize) });
});

discussionsRouter.post("/", async (req, res) => {
  const schema = z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    linkedType: z.enum(["JOB", "HUNTING", "TRANSACTION", "NONE"]).optional(),
    linkedId: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.discussion.create({
    data: {
      userId: req.user!.id,
      title: parsed.data.title,
      body: parsed.data.body,
      linkedType: parsed.data.linkedType,
      linkedId: parsed.data.linkedId ?? null,
    },
  });
  return res.status(201).json({ data });
});

discussionsRouter.post("/:id/replies", async (req, res) => {
  const discussion = await prisma.discussion.findUnique({ where: { id: req.params.id } });
  if (!discussion) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && discussion.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const schema = z.object({ body: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.discussionReply.create({
    data: {
      discussionId: discussion.id,
      authorId: req.user!.id,
      body: parsed.data.body,
    },
    include: { author: { select: { id: true, name: true } } },
  });
  return res.status(201).json({ data });
});
