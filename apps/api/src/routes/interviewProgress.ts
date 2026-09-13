import { Router } from "express";
import { z } from "zod";
import type { InterviewProgressOptionKind } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { listMeta, parsePagination } from "../pagination.js";

export const interviewProgressRouter = Router();
interviewProgressRouter.use(requireAuth);

const DEFAULT_STEPS = [
  "Phone screen",
  "Technical interview",
  "Hiring manager",
  "Final round",
  "Offer",
];

const DEFAULT_STATUSES = [
  "In progress",
  "Waiting",
  "Passed",
  "Failed",
  "On hold",
  "Withdrawn",
];

async function ensureDefaultOptions(userId: string, kind: InterviewProgressOptionKind) {
  const count = await prisma.interviewProgressOption.count({ where: { userId, kind } });
  if (count > 0) return;
  const labels = kind === "STEP" ? DEFAULT_STEPS : DEFAULT_STATUSES;
  await prisma.interviewProgressOption.createMany({
    data: labels.map((label, i) => ({
      userId,
      kind,
      label,
      sortOrder: i,
    })),
  });
}

const progressBody = z.object({
  profileId: z.string().min(1).nullable().optional(),
  jobTitle: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  jobSiteSource: z.string().optional(),
  salary: z.string().optional(),
  step: z.string().optional(),
  status: z.string().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  notes: z.string().optional(),
});

const optionBody = z.object({
  kind: z.enum(["STEP", "STATUS"]),
  label: z.string().min(1).max(80),
  sortOrder: z.number().int().optional(),
});

/* ── Options (editable dropdowns) ─────────────────────────── */

interviewProgressRouter.get("/options", async (req, res) => {
  const kindRaw = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const kindParsed = z.enum(["STEP", "STATUS"]).safeParse(kindRaw);
  const userId = req.user!.id;

  if (kindParsed.success) {
    await ensureDefaultOptions(userId, kindParsed.data);
    const data = await prisma.interviewProgressOption.findMany({
      where: { userId, kind: kindParsed.data },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    return res.json({ data });
  }

  await Promise.all([
    ensureDefaultOptions(userId, "STEP"),
    ensureDefaultOptions(userId, "STATUS"),
  ]);
  const [steps, statuses] = await Promise.all([
    prisma.interviewProgressOption.findMany({
      where: { userId, kind: "STEP" },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.interviewProgressOption.findMany({
      where: { userId, kind: "STATUS" },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);
  return res.json({ data: { steps, statuses } });
});

interviewProgressRouter.post("/options", async (req, res) => {
  const parsed = optionBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const userId = req.user!.id;
  await ensureDefaultOptions(userId, parsed.data.kind);
  const max = await prisma.interviewProgressOption.aggregate({
    where: { userId, kind: parsed.data.kind },
    _max: { sortOrder: true },
  });
  try {
    const data = await prisma.interviewProgressOption.create({
      data: {
        userId,
        kind: parsed.data.kind,
        label: parsed.data.label.trim(),
        sortOrder: parsed.data.sortOrder ?? (max._max.sortOrder ?? -1) + 1,
      },
    });
    return res.status(201).json({ data });
  } catch {
    return res.status(409).json({ error: { code: "CONFLICT", message: "Option already exists" } });
  }
});

interviewProgressRouter.put("/options/reorder", async (req, res) => {
  const parsed = z
    .object({
      kind: z.enum(["STEP", "STATUS"]),
      ids: z.array(z.string().min(1)).min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const userId = req.user!.id;
  const { kind, ids } = parsed.data;
  const existing = await prisma.interviewProgressOption.findMany({
    where: { userId, kind },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "ids must include every option for this kind exactly once" },
    });
  }

  await prisma.$transaction(
    ids.map((id, sortOrder) =>
      prisma.interviewProgressOption.update({
        where: { id },
        data: { sortOrder },
      }),
    ),
  );

  const data = await prisma.interviewProgressOption.findMany({
    where: { userId, kind },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return res.json({ data });
});

interviewProgressRouter.patch("/options/:id", async (req, res) => {
  const existing = await prisma.interviewProgressOption.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (existing.userId !== req.user!.id && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const parsed = z
    .object({
      label: z.string().min(1).max(80).optional(),
      sortOrder: z.number().int().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const nextLabel = parsed.data.label?.trim();
  try {
    const data = await prisma.$transaction(async (tx) => {
      const updated = await tx.interviewProgressOption.update({
        where: { id: existing.id },
        data: {
          label: nextLabel,
          sortOrder: parsed.data.sortOrder,
        },
      });
      if (nextLabel && nextLabel !== existing.label) {
        if (existing.kind === "STEP") {
          await tx.interviewProgress.updateMany({
            where: { userId: existing.userId, step: existing.label },
            data: { step: nextLabel },
          });
        } else {
          await tx.interviewProgress.updateMany({
            where: { userId: existing.userId, status: existing.label },
            data: { status: nextLabel },
          });
        }
      }
      return updated;
    });
    return res.json({ data });
  } catch {
    return res.status(409).json({ error: { code: "CONFLICT", message: "Option label already exists" } });
  }
});

interviewProgressRouter.delete("/options/:id", async (req, res) => {
  const existing = await prisma.interviewProgressOption.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (existing.userId !== req.user!.id && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  await prisma.interviewProgressOption.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

/* ── Progress rows ────────────────────────────────────────── */

interviewProgressRouter.get("/", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const step = typeof req.query.step === "string" ? req.query.step.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);

  const listWhere = {
    ...where,
    ...(profileId ? { profileId } : {}),
    ...(step ? { step } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { jobTitle: { contains: q, mode: "insensitive" as const } },
            { company: { contains: q, mode: "insensitive" as const } },
            { jobSiteSource: { contains: q, mode: "insensitive" as const } },
            { salary: { contains: q, mode: "insensitive" as const } },
            { notes: { contains: q, mode: "insensitive" as const } },
            { step: { contains: q, mode: "insensitive" as const } },
            { status: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.interviewProgress.count({ where: listWhere }),
    prisma.interviewProgress.findMany({
      where: listWhere,
      include: { profile: { select: { id: true, name: true } } },
      orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
      skip,
      take,
    }),
  ]);

  return res.json({
    data,
    meta: listMeta(total, page, pageSize),
  });
});

interviewProgressRouter.post("/", async (req, res) => {
  const parsed = progressBody
    .extend({
      jobTitle: z.string().min(1),
      company: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  let profileId: string | null = parsed.data.profileId ?? null;
  if (profileId) {
    const profile = await prisma.huntingProfile.findUnique({ where: { id: profileId } });
    if (!profile) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }
    if (req.user!.role !== "ADMIN" && profile.userId !== req.user!.id) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }
  }

  const data = await prisma.interviewProgress.create({
    data: {
      userId: req.user!.id,
      profileId,
      jobTitle: parsed.data.jobTitle.trim(),
      company: parsed.data.company.trim(),
      jobSiteSource: parsed.data.jobSiteSource?.trim() ?? "",
      salary: parsed.data.salary?.trim() ?? "",
      step: parsed.data.step?.trim() ?? "",
      status: parsed.data.status?.trim() ?? "",
      notes: parsed.data.notes?.trim() ?? "",
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    },
    include: { profile: { select: { id: true, name: true } } },
  });

  return res.status(201).json({ data });
});

interviewProgressRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.interviewProgress.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const parsed = progressBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  if (parsed.data.profileId) {
    const profile = await prisma.huntingProfile.findUnique({ where: { id: parsed.data.profileId } });
    if (!profile) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }
    if (req.user!.role !== "ADMIN" && profile.userId !== req.user!.id) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
    }
  }

  const data = await prisma.interviewProgress.update({
    where: { id: existing.id },
    data: {
      profileId: parsed.data.profileId === undefined ? undefined : parsed.data.profileId,
      jobTitle: parsed.data.jobTitle?.trim(),
      company: parsed.data.company?.trim(),
      jobSiteSource:
        parsed.data.jobSiteSource === undefined ? undefined : parsed.data.jobSiteSource.trim(),
      salary: parsed.data.salary === undefined ? undefined : parsed.data.salary.trim(),
      step: parsed.data.step === undefined ? undefined : parsed.data.step.trim(),
      status: parsed.data.status === undefined ? undefined : parsed.data.status.trim(),
      notes: parsed.data.notes === undefined ? undefined : parsed.data.notes.trim(),
      scheduledAt:
        parsed.data.scheduledAt === undefined
          ? undefined
          : parsed.data.scheduledAt
            ? new Date(parsed.data.scheduledAt)
            : null,
    },
    include: { profile: { select: { id: true, name: true } } },
  });

  return res.json({ data });
});

interviewProgressRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.interviewProgress.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  await prisma.interviewProgress.delete({ where: { id: existing.id } });
  return res.status(204).send();
});
