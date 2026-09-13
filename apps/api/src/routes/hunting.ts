import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { createScheduleEvent, deleteLinkedCalendarEvents } from "../calendarSync.js";
import { countIcsScheduleEvents, listIcsScheduleEvents } from "../integrations/icsSync.js";
import { listMeta, parsePagination } from "../pagination.js";
import {
  bidDateFilter,
  interviewListDateFilter,
  parseAnchorDate,
  parsePeriod,
  resolvePeriod,
} from "../period.js";
import { resolveActorTimeZone } from "../requestTimeZone.js";
import { attachScheduleRoutes } from "./schedules.js";
import { interviewProgressRouter } from "./interviewProgress.js";
import {
  appendJobToSpreadsheet,
  fetchSheetJobRows,
  mapSheetStatusToBidStatus,
  markJobAppliedOnSpreadsheet,
  normalizeJobLink,
  parseSheetDate,
  sheetStatusLooksReady,
} from "../integrations/bidSheet.js";
import {
  fetchJobsFromCaptureBot,
  normalizeCaptureBotUrl,
  parseCaptureCsv,
  serializeCaptureCsv,
  type CaptureJobInput,
} from "../integrations/captureBot.js";
import { ensureAllIcsFeedHuntingProfiles } from "../integrations/icsSync.js";

export const huntingRouter = Router();
huntingRouter.use(requireAuth);

const optionalUrl = z.union([z.string().url(), z.literal(""), z.null()]).optional();

const profileBody = z.object({
  name: z.string().min(1).optional(),
  label: z.string().optional(),
  country: z.string().max(80).optional(),
  active: z.boolean().optional(),
  spreadsheetUrl: z.string().optional(),
  sheetsWebAppUrl: z.string().optional(),
  sheetTabName: z.string().optional(),
  captureBotUrl: z.string().optional(),
});

const bidStatuses = ["DRAFT", "SENT", "SHORTLISTED", "REJECTED", "WITHDRAWN", "WON"] as const;
const interviewStatuses = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
const capturedStatuses = ["NEW", "QUEUED", "DISMISSED", "BIDDED"] as const;

const bidBody = z.object({
  profileId: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  roleTitle: z.string().min(1).optional(),
  status: z.enum(bidStatuses).optional(),
  sourceUrl: optionalUrl,
  salary: z.string().optional(),
  notes: z.string().optional(),
  amountMinor: z.number().int().nullable().optional(),
  currency: z.string().min(1).max(8).optional(),
  appliedAt: z.string().datetime().nullable().optional(),
  pushToSheet: z.boolean().optional(),
});

const interviewBody = z.object({
  profileId: z.string().min(1).optional(),
  bidId: z.string().min(1).nullable().optional(),
  company: z.string().min(1).optional(),
  roleTitle: z.string().min(1).optional(),
  status: z.enum(interviewStatuses).optional(),
  notes: z.string().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  scheduleEndsAt: z.string().datetime().nullable().optional(),
});

const captureBody = z.object({
  profileId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  company: z.string().optional(),
  sourceUrl: optionalUrl,
  salary: z.string().optional(),
  description: z.string().optional(),
  platform: z.string().optional(),
  status: z.enum(capturedStatuses).optional(),
});

async function assertProfileOwned(profileId: string, userId: string, role: string) {
  const profile = await prisma.huntingProfile.findUnique({ where: { id: profileId } });
  if (!profile) return { error: "NOT_FOUND" as const };
  if (role !== "ADMIN" && profile.userId !== userId) return { error: "FORBIDDEN" as const };
  return { profile };
}

async function assertProfileExists(profileId: string) {
  const profile = await prisma.huntingProfile.findUnique({ where: { id: profileId } });
  if (!profile) return { error: "NOT_FOUND" as const };
  return { profile };
}

async function assertBidOwned(bidId: string, userId: string, role: string, profileId?: string) {
  const bid = await prisma.huntingBid.findUnique({ where: { id: bidId } });
  if (!bid) return { error: "NOT_FOUND" as const };
  if (role !== "ADMIN" && bid.userId !== userId) return { error: "FORBIDDEN" as const };
  if (profileId && bid.profileId !== profileId) return { error: "VALIDATION" as const };
  return { bid };
}

function profileHasSheet(profile: { spreadsheetUrl: string; sheetsWebAppUrl: string }) {
  return Boolean(profile.spreadsheetUrl?.trim() && profile.sheetsWebAppUrl?.trim());
}

function sheetConfigFor(profile: {
  spreadsheetUrl: string;
  sheetsWebAppUrl: string;
  sheetTabName: string;
  name: string;
}) {
  return {
    spreadsheetUrl: profile.spreadsheetUrl,
    sheetsWebAppUrl: profile.sheetsWebAppUrl,
    sheetTabName: profile.sheetTabName?.trim() || profile.name,
  };
}

/* ── Profiles ─────────────────────────────────────────────── */

huntingRouter.get("/profiles", async (req, res) => {
  const scopeAll = req.query.scope === "all";
  const where = scopeAll
    ? {}
    : ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const activeOnly = req.query.active === "true";
  const country =
    typeof req.query.country === "string" ? req.query.country.trim() : "";
  // Imported calendars get hunting profiles so they appear in Bid Tracking
  if (!scopeAll && "userId" in where && where.userId) {
    await ensureAllIcsFeedHuntingProfiles(where.userId);
  } else if (!scopeAll) {
    await ensureAllIcsFeedHuntingProfiles(req.user!.id);
  } else {
    await ensureAllIcsFeedHuntingProfiles(req.user!.id);
  }
  const data = await prisma.huntingProfile.findMany({
    where: {
      ...where,
      ...(activeOnly ? { active: true } : {}),
      ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
      icsFeed: { select: { id: true, label: true, color: true, url: true } },
    },
    orderBy: [{ active: "desc" }, { country: "asc" }, { name: "asc" }],
  });
  return res.json({ data });
});

huntingRouter.post("/profiles", async (req, res) => {
  const parsed = profileBody.extend({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.huntingProfile.create({
    data: {
      userId: req.user!.id,
      name: parsed.data.name.trim(),
      label: parsed.data.label?.trim() ?? "",
      country: parsed.data.country?.trim() ?? "",
      active: parsed.data.active ?? true,
      spreadsheetUrl: parsed.data.spreadsheetUrl?.trim() ?? "",
      sheetsWebAppUrl: parsed.data.sheetsWebAppUrl?.trim() ?? "",
      sheetTabName: parsed.data.sheetTabName?.trim() ?? "",
    },
  });
  return res.status(201).json({ data });
});

huntingRouter.patch("/profiles/:id", async (req, res) => {
  const check = await assertProfileOwned(req.params.id, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const parsed = profileBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.huntingProfile.update({
    where: { id: req.params.id },
    data: {
      name: parsed.data.name?.trim(),
      label: parsed.data.label === undefined ? undefined : parsed.data.label.trim(),
      country: parsed.data.country === undefined ? undefined : parsed.data.country.trim(),
      active: parsed.data.active,
      spreadsheetUrl:
        parsed.data.spreadsheetUrl === undefined ? undefined : parsed.data.spreadsheetUrl.trim(),
      sheetsWebAppUrl:
        parsed.data.sheetsWebAppUrl === undefined ? undefined : parsed.data.sheetsWebAppUrl.trim(),
      sheetTabName:
        parsed.data.sheetTabName === undefined ? undefined : parsed.data.sheetTabName.trim(),
      captureBotUrl:
        parsed.data.captureBotUrl === undefined
          ? undefined
          : normalizeCaptureBotUrl(parsed.data.captureBotUrl) || "http://127.0.0.1:3847",
    },
  });
  return res.json({ data });
});

huntingRouter.delete("/profiles/:id", async (req, res) => {
  const check = await assertProfileOwned(req.params.id, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const interviews = await prisma.huntingInterview.findMany({
    where: { profileId: req.params.id },
    select: { id: true, userId: true },
  });
  for (const iv of interviews) {
    await deleteLinkedCalendarEvents(iv.userId, "HUNTING", iv.id);
  }
  await prisma.huntingProfile.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

huntingRouter.post("/profiles/:id/sheet/sync", async (req, res) => {
  const check = await assertProfileOwned(req.params.id, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const profile = check.profile!;
  if (!profileHasSheet(profile)) {
    return res.status(400).json({
      error: {
        code: "VALIDATION",
        message: "Set spreadsheet URL and Apps Script web app URL on this profile first.",
      },
    });
  }

  try {
    const rows = await fetchSheetJobRows(sheetConfigFor(profile));

    let bidsCreated = 0;
    let bidsUpdated = 0;

    for (const row of rows) {
      const sheetKey = normalizeJobLink(row.link) || `row:${row.row ?? row.title}:${row.company}`;
      const roleTitle = row.title || "Untitled role";
      const company = row.company || "Unknown";
      const sourceUrl = row.link || null;
      const bidStatus = sheetStatusLooksReady(row.status)
        ? ("DRAFT" as const)
        : mapSheetStatusToBidStatus(row.status);
      const sheetDate = parseSheetDate(row.date);
      const appliedLike =
        bidStatus === "SENT" || bidStatus === "SHORTLISTED" || bidStatus === "WON";
      // Sheet "Created Date" drives Daily/Weekly/Monthly views; fall back to now for applied rows.
      const resolvedAppliedAt = sheetDate ?? (appliedLike ? new Date() : null);

      const existingBid = await prisma.huntingBid.findFirst({
        where: { profileId: profile.id, sheetKey },
      });
      if (existingBid) {
        await prisma.huntingBid.update({
          where: { id: existingBid.id },
          data: {
            company,
            roleTitle,
            status: bidStatus,
            sourceUrl,
            salary: row.salary || existingBid.salary,
            source: "SHEET",
            appliedAt:
              sheetDate ??
              existingBid.appliedAt ??
              (appliedLike ? new Date() : existingBid.appliedAt),
          },
        });
        bidsUpdated += 1;
      } else {
        await prisma.huntingBid.create({
          data: {
            userId: profile.userId,
            profileId: profile.id,
            company,
            roleTitle,
            status: bidStatus,
            source: "SHEET",
            sheetKey,
            sourceUrl,
            salary: row.salary || "",
            appliedAt: resolvedAppliedAt,
          },
        });
        bidsCreated += 1;
      }
    }

    const updatedProfile = await prisma.huntingProfile.update({
      where: { id: profile.id },
      data: { sheetSyncedAt: new Date() },
    });

    return res.json({
      data: {
        profile: updatedProfile,
        meta: { bidsCreated, bidsUpdated, rowCount: rows.length },
      },
    });
  } catch (err) {
    return res.status(502).json({
      error: { code: "SHEET_SYNC", message: err instanceof Error ? err.message : "Sheet sync failed" },
    });
  }
});

async function upsertCapturedJobs(
  profile: { id: string; userId: string },
  jobs: CaptureJobInput[],
  actorUserId?: string
) {
  const postedByUserId = actorUserId || profile.userId;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const job of jobs) {
    const existing = await prisma.capturedJob.findFirst({
      where: { externalId: job.externalId },
    });
    if (existing) {
      // Already on the shared New jobs feed (same or another domain) — skip cross-domain dupes.
      if (existing.profileId !== profile.id) {
        skipped += 1;
        continue;
      }
      if (existing.status === "BIDDED" || existing.status === "DISMISSED") {
        skipped += 1;
        continue;
      }
      await prisma.capturedJob.update({
        where: { id: existing.id },
        data: {
          title: job.title,
          company: job.company,
          sourceUrl: job.sourceUrl,
          salary: job.salary || existing.salary,
          description: job.description || existing.description,
          platform: job.platform || existing.platform,
          payloadJson: job.payloadJson || existing.payloadJson,
        },
      });
      updated += 1;
    } else {
      await prisma.capturedJob.create({
        data: {
          userId: postedByUserId,
          profileId: profile.id,
          externalId: job.externalId,
          title: job.title,
          company: job.company,
          sourceUrl: job.sourceUrl,
          salary: job.salary,
          description: job.description,
          platform: job.platform,
          status: "NEW",
          payloadJson: job.payloadJson,
        },
      });
      created += 1;
    }
  }

  return { created, updated, skipped, total: jobs.length };
}

huntingRouter.post("/profiles/:id/capture/sync", async (req, res) => {
  const check = await assertProfileOwned(req.params.id, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const profile = check.profile!;
  const bodyUrl =
    typeof req.body?.captureBotUrl === "string" ? normalizeCaptureBotUrl(req.body.captureBotUrl) : "";
  const baseUrl = bodyUrl || profile.captureBotUrl || "http://127.0.0.1:3847";

  try {
    const jobs = await fetchJobsFromCaptureBot(baseUrl, {
      status: typeof req.body?.status === "string" ? req.body.status : "new",
      limit: 500,
    });
    const meta = await upsertCapturedJobs(profile, jobs);
    const updatedProfile = await prisma.huntingProfile.update({
      where: { id: profile.id },
      data: {
        captureBotUrl: baseUrl,
        captureSyncedAt: new Date(),
      },
    });
    return res.json({ data: { profile: updatedProfile, meta } });
  } catch (err) {
    return res.status(502).json({
      error: {
        code: "CAPTURE_SYNC",
        message: err instanceof Error ? err.message : "Capture bot sync failed",
      },
    });
  }
});

huntingRouter.post("/profiles/:id/capture/import-csv", async (req, res) => {
  const check = await assertProfileExists(req.params.id);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  const csvText = typeof req.body?.csv === "string" ? req.body.csv : "";
  if (!csvText.trim()) {
    return res.status(400).json({
      error: {
        code: "VALIDATION",
        message: "Body must include csv text with columns: title, company, link, salary, jd.",
      },
    });
  }
  const rawName = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
  const fileName = rawName.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200) || "jobs.csv";

  try {
    const jobs = parseCaptureCsv(csvText);
    const meta = await upsertCapturedJobs(check.profile!, jobs, req.user!.id);
    const uploadedAt = new Date();
    await prisma.jobFileMeta.upsert({
      where: { id: "workspace" },
      create: {
        id: "workspace",
        fileName,
        uploadedAt,
        uploadedById: req.user!.id,
      },
      update: {
        fileName,
        uploadedAt,
        uploadedById: req.user!.id,
      },
    });
    return res.json({ data: { meta, file: { fileName, uploadedAt } } });
  } catch (err) {
    return res.status(400).json({
      error: {
        code: "VALIDATION",
        message: err instanceof Error ? err.message : "CSV import failed",
      },
    });
  }
});

huntingRouter.get("/profiles/:id/capture/export-csv", async (req, res) => {
  const check = await assertProfileExists(req.params.id);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }

  const jobs = await prisma.capturedJob.findMany({
    where: { profileId: check.profile!.id },
    orderBy: { capturedAt: "desc" },
  });
  const csv = serializeCaptureCsv(jobs);
  const safeName = (check.profile!.name || "jobs").replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-jobs.csv"`);
  return res.send(csv);
});

huntingRouter.get("/fetch/export-csv", async (_req, res) => {
  const jobs = await prisma.capturedJob.findMany({
    orderBy: { capturedAt: "desc" },
  });
  const csv = serializeCaptureCsv(jobs);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="jobs.csv"');
  return res.send(csv);
});

huntingRouter.get("/fetch/file-status", async (_req, res) => {
  const [jobCount, latest, fileMeta] = await Promise.all([
    prisma.capturedJob.count(),
    prisma.capturedJob.findFirst({
      orderBy: [{ updatedAt: "desc" }],
      select: { updatedAt: true, capturedAt: true },
    }),
    prisma.jobFileMeta.findUnique({
      where: { id: "workspace" },
      include: { uploadedBy: { select: { id: true, name: true } } },
    }),
  ]);

  return res.json({
    data: {
      jobCount,
      fileName: fileMeta?.fileName || null,
      uploadedAt: fileMeta?.uploadedAt?.toISOString() ?? null,
      uploadedBy: fileMeta?.uploadedBy ?? null,
      lastUpdatedAt:
        latest?.updatedAt?.toISOString() ?? latest?.capturedAt?.toISOString() ?? null,
    },
  });
});

huntingRouter.delete("/fetch", async (_req, res) => {
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.capturedJob.deleteMany({});
    await tx.jobFileMeta.deleteMany({ where: { id: "workspace" } });
    return deleted;
  });
  return res.json({ data: { deleted: result.count } });
});

/* ── New jobs / Job fetch (CapturedJob) — shared across all users ── */

huntingRouter.get("/fetch", async (req, res) => {
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
  const statusParsed = z.enum(capturedStatuses).safeParse(req.query.status);
  const openOnly = req.query.open === "true";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);

  const baseWhere: Prisma.CapturedJobWhereInput = {
    ...(profileId ? { profileId } : {}),
  };
  const listWhere: Prisma.CapturedJobWhereInput = {
    ...baseWhere,
    ...(statusParsed.success
      ? { status: statusParsed.data }
      : openOnly
        ? { status: { in: ["NEW", "QUEUED"] } }
        : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { salary: { contains: q, mode: "insensitive" } },
            { sourceUrl: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, data, statusGroups] = await Promise.all([
    prisma.capturedJob.count({ where: listWhere }),
    prisma.capturedJob.findMany({
      where: listWhere,
      orderBy: { capturedAt: "desc" },
      skip,
      take,
      include: {
        user: { select: { id: true, name: true } },
        profile: { select: { id: true, name: true, userId: true } },
      },
    }),
    prisma.capturedJob.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const countsByStatus = Object.fromEntries(
    capturedStatuses.map((s) => [s, statusGroups.find((g) => g.status === s)?._count._all ?? 0]),
  ) as Record<(typeof capturedStatuses)[number], number>;

  return res.json({
    data,
    meta: { ...listMeta(total, page, pageSize), countsByStatus },
  });
});

huntingRouter.post("/fetch", async (req, res) => {
  const parsed = captureBody
    .extend({
      profileId: z.string().min(1),
      title: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const check = await assertProfileExists(parsed.data.profileId);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  }

  const sourceUrl = parsed.data.sourceUrl || null;
  const externalId = sourceUrl ? normalizeJobLink(sourceUrl) : null;
  if (externalId) {
    const dup = await prisma.capturedJob.findFirst({
      where: { externalId },
    });
    if (dup) {
      return res.status(409).json({ error: { code: "CONFLICT", message: "Job link already fetched" } });
    }
  }

  const data = await prisma.capturedJob.create({
    data: {
      userId: req.user!.id,
      profileId: parsed.data.profileId,
      externalId,
      title: parsed.data.title.trim(),
      company: parsed.data.company?.trim() ?? "",
      sourceUrl,
      salary: parsed.data.salary?.trim() ?? "",
      description: parsed.data.description ?? "",
      platform: parsed.data.platform?.trim() ?? "manual",
      status: parsed.data.status ?? "NEW",
    },
    include: {
      user: { select: { id: true, name: true } },
      profile: { select: { id: true, name: true, userId: true } },
    },
  });
  return res.status(201).json({ data });
});

huntingRouter.patch("/fetch/:id", async (req, res) => {
  const existing = await prisma.capturedJob.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  const parsed = captureBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.capturedJob.update({
    where: { id: existing.id },
    data: {
      title: parsed.data.title?.trim(),
      company: parsed.data.company === undefined ? undefined : parsed.data.company.trim(),
      sourceUrl: parsed.data.sourceUrl === undefined ? undefined : parsed.data.sourceUrl || null,
      salary: parsed.data.salary === undefined ? undefined : parsed.data.salary.trim(),
      description: parsed.data.description,
      platform: parsed.data.platform === undefined ? undefined : parsed.data.platform.trim(),
      status: parsed.data.status,
    },
    include: {
      user: { select: { id: true, name: true } },
      profile: { select: { id: true, name: true, userId: true } },
    },
  });
  return res.json({ data });
});

huntingRouter.delete("/fetch/:id", async (req, res) => {
  const existing = await prisma.capturedJob.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  await prisma.capturedJob.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

huntingRouter.post("/fetch/:id/promote", async (req, res) => {
  const existing = await prisma.capturedJob.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }

  const pushToSheet = Boolean(req.body?.pushToSheet);
  const sheetKey = existing.externalId || (existing.sourceUrl ? normalizeJobLink(existing.sourceUrl) : null);

  let bid = sheetKey
    ? await prisma.huntingBid.findFirst({
        where: { userId: req.user!.id, profileId: existing.profileId, sheetKey },
      })
    : null;

  if (!bid) {
    bid = await prisma.huntingBid.create({
      data: {
        userId: req.user!.id,
        profileId: existing.profileId,
        company: existing.company || "Unknown",
        roleTitle: existing.title,
        status: "DRAFT",
        source: existing.platform === "sheet" ? "SHEET" : "MANUAL",
        sheetKey,
        sourceUrl: existing.sourceUrl,
        salary: existing.salary,
        notes: existing.description,
      },
    });
  }

  await prisma.capturedJob.update({
    where: { id: existing.id },
    data: { status: "BIDDED" },
  });

  if (pushToSheet) {
    const profile = await prisma.huntingProfile.findUnique({ where: { id: existing.profileId } });
    if (profile && profileHasSheet(profile)) {
      try {
        await appendJobToSpreadsheet(
          sheetConfigFor(profile),
          {
            jobTitle: bid.roleTitle,
            companyName: bid.company,
            jdLink: bid.sourceUrl || undefined,
            salary: bid.salary || undefined,
            status: "Ready",
          }
        );
      } catch (err) {
        return res.status(201).json({
          data: { bid, captured: existing },
          warning: err instanceof Error ? err.message : "Sheet append failed",
        });
      }
    }
  }

  return res.status(201).json({ data: { bid } });
});

/* ── Bids ─────────────────────────────────────────────────── */

huntingRouter.get("/bids", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
  const statusParsed = z.enum(bidStatuses).safeParse(req.query.status);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);
  const scopeUserId = typeof where.userId === "string" ? where.userId : req.user!.id;
  const timeZone = await resolveActorTimeZone(req, scopeUserId);
  const period = parsePeriod(req.query.period);
  const anchor = parseAnchorDate(req.query.date, timeZone);
  const { from, to } = resolvePeriod(period, anchor, timeZone);
  const range = { gte: from, lt: to };
  const dateFilter = bidDateFilter(range);

  const andFilters: Prisma.HuntingBidWhereInput[] = [dateFilter];
  if (q) {
    andFilters.push({
      OR: [
        { company: { contains: q, mode: "insensitive" } },
        { roleTitle: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { salary: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const baseWhere: Prisma.HuntingBidWhereInput = {
    ...where,
    ...(profileId ? { profileId } : {}),
    ...dateFilter,
  };
  const listWhere: Prisma.HuntingBidWhereInput = {
    ...where,
    ...(profileId ? { profileId } : {}),
    ...(statusParsed.success ? { status: statusParsed.data } : {}),
    AND: andFilters,
  };

  const [total, data, statusGroups] = await Promise.all([
    prisma.huntingBid.count({ where: listWhere }),
    prisma.huntingBid.findMany({
      where: listWhere,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
    prisma.huntingBid.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const countsByStatus = Object.fromEntries(
    bidStatuses.map((s) => [s, statusGroups.find((g) => g.status === s)?._count._all ?? 0]),
  ) as Record<(typeof bidStatuses)[number], number>;

  return res.json({
    data,
    meta: { ...listMeta(total, page, pageSize), countsByStatus },
  });
});

huntingRouter.post("/bids", async (req, res) => {
  const parsed = bidBody
    .extend({
      profileId: z.string().min(1),
      company: z.string().min(1),
      roleTitle: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const check = await assertProfileOwned(parsed.data.profileId, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const profile = check.profile!;
  const sourceUrl = parsed.data.sourceUrl || null;
  const sheetKey = sourceUrl ? normalizeJobLink(sourceUrl) : null;

  const data = await prisma.huntingBid.create({
    data: {
      userId: req.user!.id,
      profileId: parsed.data.profileId,
      company: parsed.data.company.trim(),
      roleTitle: parsed.data.roleTitle.trim(),
      status: parsed.data.status ?? "DRAFT",
      source: "MANUAL",
      sheetKey,
      sourceUrl,
      salary: parsed.data.salary?.trim() ?? "",
      notes: parsed.data.notes ?? "",
      amountMinor: parsed.data.amountMinor ?? null,
      currency: parsed.data.currency ?? "USD",
      appliedAt: parsed.data.appliedAt ? new Date(parsed.data.appliedAt) : null,
    },
  });

  if (parsed.data.pushToSheet && profileHasSheet(profile)) {
    try {
      const status =
        data.status === "SENT" || data.status === "SHORTLISTED" || data.status === "WON"
          ? undefined
          : "Ready";
      if (status === "Ready") {
        await appendJobToSpreadsheet(
          sheetConfigFor(profile),
          {
            jobTitle: data.roleTitle,
            companyName: data.company,
            jdLink: data.sourceUrl || undefined,
            salary: data.salary || undefined,
            status: "Ready",
          }
        );
      } else {
        await markJobAppliedOnSpreadsheet(
          sheetConfigFor(profile),
          {
            jobTitle: data.roleTitle,
            companyName: data.company,
            jdLink: data.sourceUrl || undefined,
            salary: data.salary || undefined,
          }
        );
      }
    } catch (err) {
      return res.status(201).json({
        data,
        warning: err instanceof Error ? err.message : "Sheet push failed",
      });
    }
  }

  return res.status(201).json({ data });
});

huntingRouter.patch("/bids/:id", async (req, res) => {
  const existing = await prisma.huntingBid.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const parsed = bidBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  if (parsed.data.profileId && parsed.data.profileId !== existing.profileId) {
    const check = await assertProfileOwned(parsed.data.profileId, req.user!.id, req.user!.role);
    if ("error" in check) {
      return res.status(check.error === "FORBIDDEN" ? 403 : 404).json({
        error: { code: check.error, message: check.error === "FORBIDDEN" ? "Not yours" : "Profile not found" },
      });
    }
  }

  const nextUrl =
    parsed.data.sourceUrl === undefined ? existing.sourceUrl : parsed.data.sourceUrl || null;

  const data = await prisma.huntingBid.update({
    where: { id: existing.id },
    data: {
      profileId: parsed.data.profileId,
      company: parsed.data.company?.trim(),
      roleTitle: parsed.data.roleTitle?.trim(),
      status: parsed.data.status,
      notes: parsed.data.notes,
      salary: parsed.data.salary === undefined ? undefined : parsed.data.salary.trim(),
      sourceUrl: parsed.data.sourceUrl === undefined ? undefined : parsed.data.sourceUrl || null,
      sheetKey: nextUrl ? normalizeJobLink(nextUrl) : existing.sheetKey,
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency,
      appliedAt:
        parsed.data.appliedAt === undefined
          ? undefined
          : parsed.data.appliedAt
            ? new Date(parsed.data.appliedAt)
            : null,
    },
  });

  if (parsed.data.pushToSheet) {
    const profile = await prisma.huntingProfile.findUnique({ where: { id: data.profileId } });
    if (profile && profileHasSheet(profile) && (data.status === "SENT" || data.status === "WON")) {
      try {
        await markJobAppliedOnSpreadsheet(
          sheetConfigFor(profile),
          {
            jobTitle: data.roleTitle,
            companyName: data.company,
            jdLink: data.sourceUrl || undefined,
            salary: data.salary || undefined,
          }
        );
      } catch (err) {
        return res.json({
          data,
          warning: err instanceof Error ? err.message : "Sheet update failed",
        });
      }
    }
  }

  return res.json({ data });
});

huntingRouter.delete("/bids/:id", async (req, res) => {
  const existing = await prisma.huntingBid.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  await prisma.huntingBid.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

/* ── Interviews ───────────────────────────────────────────── */

async function linkedHuntingScheduleIds(opts: {
  userId?: string;
  interviewIds?: string[];
  startsAt?: { gte: Date; lt: Date };
}) {
  const rows = await prisma.calendarEvent.findMany({
    where: {
      sourceType: "HUNTING",
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.interviewIds ? { sourceId: { in: opts.interviewIds } } : {}),
      ...(opts.startsAt ? { startsAt: opts.startsAt } : {}),
    },
    select: { sourceId: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
  });
  const byInterview = new Map<string, { startsAt: Date; endsAt: Date | null; count: number }>();
  for (const row of rows) {
    if (!row.sourceId) continue;
    const prev = byInterview.get(row.sourceId);
    if (!prev) {
      byInterview.set(row.sourceId, { startsAt: row.startsAt, endsAt: row.endsAt, count: 1 });
    } else {
      prev.count += 1;
    }
  }
  return byInterview;
}

async function enrichInterviewsWithSchedules<
  T extends {
    id: string;
    scheduledAt: Date | null;
    scheduleEndsAt: Date | null;
  },
>(rows: T[], userId?: string) {
  if (rows.length === 0) return rows as Array<T & { scheduleCount: number }>;
  const linked = await linkedHuntingScheduleIds({
    userId,
    interviewIds: rows.map((r) => r.id),
  });
  return rows.map((row) => {
    const sched = linked.get(row.id);
    const scheduledAt = row.scheduledAt ?? sched?.startsAt ?? null;
    const scheduleEndsAt = row.scheduleEndsAt ?? sched?.endsAt ?? null;
    const scheduleCount = sched?.count ?? (row.scheduledAt ? 1 : 0);
    return { ...row, scheduledAt, scheduleEndsAt, scheduleCount };
  });
}

huntingRouter.get("/interviews", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
  const icsFeedId = typeof req.query.icsFeedId === "string" ? req.query.icsFeedId : undefined;
  const statusParsed = z.enum(interviewStatuses).safeParse(req.query.status);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);
  const scopeUserId = typeof where.userId === "string" ? where.userId : req.user!.id;
  const timeZone = await resolveActorTimeZone(req, scopeUserId);
  const period = parsePeriod(req.query.period);
  const anchor = parseAnchorDate(req.query.date, timeZone);
  const { from, to } = resolvePeriod(period, anchor, timeZone);
  const range = { gte: from, lt: to };
  const icsStartsAt = range;
  const dateFilter = interviewListDateFilter(range);
  const ownerUserId = typeof where.userId === "string" ? where.userId : undefined;

  /* Imported ICS calendar → interview schedules for that feed */
  if (icsFeedId) {
    const feed = await prisma.calendarIcsFeed.findFirst({
      where: { id: icsFeedId, ...(where.userId ? { userId: where.userId } : {}) },
    });
    if (!feed) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Imported calendar not found" } });
    }

    const status = statusParsed.success ? statusParsed.data : undefined;
    const scheduledCount = await countIcsScheduleEvents({
      userId: feed.userId,
      feedId: feed.id,
      startsAt: icsStartsAt,
    });
    if (status && status !== "SCHEDULED") {
      const emptyCounts = Object.fromEntries(interviewStatuses.map((s) => [s, 0])) as Record<
        (typeof interviewStatuses)[number],
        number
      >;
      emptyCounts.SCHEDULED = scheduledCount;
      return res.json({
        data: [],
        meta: { ...listMeta(0, page, pageSize), countsByStatus: emptyCounts },
      });
    }

    const [total, rows] = await Promise.all([
      countIcsScheduleEvents({
        userId: feed.userId,
        feedId: feed.id,
        q: q || undefined,
        startsAt: icsStartsAt,
      }),
      listIcsScheduleEvents({
        userId: feed.userId,
        feedId: feed.id,
        q: q || undefined,
        startsAt: icsStartsAt,
        skip,
        take,
      }),
    ]);

    const countsByStatus = Object.fromEntries(interviewStatuses.map((s) => [s, 0])) as Record<
      (typeof interviewStatuses)[number],
      number
    >;
    countsByStatus.SCHEDULED = scheduledCount;

    return res.json({
      data: rows.map((r) => ({ ...r, scheduleCount: 1 })),
      meta: { ...listMeta(total, page, pageSize), countsByStatus },
    });
  }

  const includeImported = req.query.includeImported !== "false";
  const statusFilterActive = statusParsed.success ? statusParsed.data : undefined;
  const canIncludeIcs =
    includeImported && (!statusFilterActive || statusFilterActive === "SCHEDULED");

  const linkedInPeriod = await linkedHuntingScheduleIds({
    userId: ownerUserId,
    startsAt: range,
  });
  let linkedIds = [...linkedInPeriod.keys()];
  if (linkedIds.length > 0 && profileId) {
    const owned = await prisma.huntingInterview.findMany({
      where: { id: { in: linkedIds }, profileId, ...where },
      select: { id: true },
    });
    linkedIds = owned.map((r) => r.id);
  }

  const huntingDateClause: Prisma.HuntingInterviewWhereInput =
    linkedIds.length > 0
      ? { OR: [dateFilter, { id: { in: linkedIds } }] }
      : dateFilter;

  const baseWhere: Prisma.HuntingInterviewWhereInput = {
    ...where,
    ...(profileId ? { profileId } : {}),
    ...huntingDateClause,
  };
  const andFilters: Prisma.HuntingInterviewWhereInput[] = [huntingDateClause];
  if (q) {
    andFilters.push({
      OR: [
        { company: { contains: q, mode: "insensitive" } },
        { roleTitle: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const listWhere: Prisma.HuntingInterviewWhereInput = {
    ...where,
    ...(profileId ? { profileId } : {}),
    ...(statusParsed.success ? { status: statusParsed.data } : {}),
    ...(andFilters.length > 0 ? { AND: andFilters } : {}),
  };

  const [huntingTotal, huntingRows, statusGroups, icsScheduledCount] = await Promise.all([
    prisma.huntingInterview.count({ where: listWhere }),
    prisma.huntingInterview.findMany({
      where: listWhere,
      orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
      // Fetch period window for merge; paginate after combining with ICS
      take: canIncludeIcs ? 500 : take,
      skip: canIncludeIcs ? 0 : skip,
    }),
    prisma.huntingInterview.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
    canIncludeIcs
      ? countIcsScheduleEvents({
          userId: ownerUserId,
          profileId,
          startsAt: icsStartsAt,
          q: q || undefined,
        })
      : Promise.resolve(0),
  ]);

  const countsByStatus = Object.fromEntries(
    interviewStatuses.map((s) => [s, statusGroups.find((g) => g.status === s)?._count._all ?? 0]),
  ) as Record<(typeof interviewStatuses)[number], number>;
  if (canIncludeIcs) {
    countsByStatus.SCHEDULED = (countsByStatus.SCHEDULED ?? 0) + icsScheduledCount;
  }

  const enrichedHunting = await enrichInterviewsWithSchedules(huntingRows, ownerUserId);
  const huntingMapped = enrichedHunting.map((row) => ({
    ...row,
    source: "HUNTING" as const,
    readOnly: false as const,
  }));

  if (!canIncludeIcs) {
    return res.json({
      data: huntingMapped,
      meta: { ...listMeta(huntingTotal, page, pageSize), countsByStatus },
    });
  }

  const icsRows = await listIcsScheduleEvents({
    userId: ownerUserId,
    profileId,
    startsAt: icsStartsAt,
    q: q || undefined,
    take: 500,
  });

  type Merged = (typeof huntingMapped)[number] | (typeof icsRows)[number];
  const merged: Merged[] = [...huntingMapped, ...icsRows.map((r) => ({ ...r, scheduleCount: 1 }))];
  merged.sort((a, b) => {
    const aAt = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    const bAt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    return aAt - bAt;
  });

  const total = huntingTotal + icsScheduledCount;
  const pageRows = merged.slice(skip, skip + take);

  return res.json({
    data: pageRows,
    meta: { ...listMeta(total, page, pageSize), countsByStatus },
  });
});

huntingRouter.post("/interviews", async (req, res) => {
  const parsed = interviewBody
    .extend({
      profileId: z.string().min(1),
      company: z.string().min(1),
      roleTitle: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const check = await assertProfileOwned(parsed.data.profileId, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }

  let bidId: string | null = parsed.data.bidId ?? null;
  if (bidId) {
    const bidCheck = await assertBidOwned(bidId, req.user!.id, req.user!.role, parsed.data.profileId);
    if ("error" in bidCheck) {
      const code = bidCheck.error === "VALIDATION" ? 400 : bidCheck.error === "FORBIDDEN" ? 403 : 404;
      return res.status(code).json({
        error: {
          code: bidCheck.error,
          message:
            bidCheck.error === "VALIDATION"
              ? "Bid must belong to the same profile"
              : bidCheck.error === "FORBIDDEN"
                ? "Not yours"
                : "Bid not found",
        },
      });
    }
  }

  const data = await prisma.huntingInterview.create({
    data: {
      userId: req.user!.id,
      profileId: parsed.data.profileId,
      bidId,
      company: parsed.data.company.trim(),
      roleTitle: parsed.data.roleTitle.trim(),
      status: parsed.data.status ?? "SCHEDULED",
      notes: parsed.data.notes ?? "",
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      scheduleEndsAt: parsed.data.scheduleEndsAt ? new Date(parsed.data.scheduleEndsAt) : null,
    },
  });

  if (data.scheduledAt) {
    await createScheduleEvent({
      userId: data.userId,
      sourceType: "HUNTING",
      sourceId: data.id,
      title: `${data.company} — ${data.roleTitle}`,
      startsAt: data.scheduledAt,
      endsAt: data.scheduleEndsAt ?? new Date(data.scheduledAt.getTime() + 60 * 60 * 1000),
      allDay: false,
      description: data.notes,
      tag: "SCHEDULE",
    });
  }

  return res.status(201).json({ data });
});

huntingRouter.patch("/interviews/:id", async (req, res) => {
  const existing = await prisma.huntingInterview.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const parsed = interviewBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const nextProfileId = parsed.data.profileId ?? existing.profileId;
  if (parsed.data.profileId && parsed.data.profileId !== existing.profileId) {
    const check = await assertProfileOwned(parsed.data.profileId, req.user!.id, req.user!.role);
    if ("error" in check) {
      return res.status(check.error === "FORBIDDEN" ? 403 : 404).json({
        error: { code: check.error, message: check.error === "FORBIDDEN" ? "Not yours" : "Profile not found" },
      });
    }
  }

  let bidId = parsed.data.bidId === undefined ? existing.bidId : parsed.data.bidId;
  if (bidId) {
    const bidCheck = await assertBidOwned(bidId, req.user!.id, req.user!.role, nextProfileId);
    if ("error" in bidCheck) {
      const code = bidCheck.error === "VALIDATION" ? 400 : bidCheck.error === "FORBIDDEN" ? 403 : 404;
      return res.status(code).json({
        error: {
          code: bidCheck.error,
          message:
            bidCheck.error === "VALIDATION"
              ? "Bid must belong to the same profile"
              : bidCheck.error === "FORBIDDEN"
                ? "Not yours"
                : "Bid not found",
        },
      });
    }
  }

  const data = await prisma.huntingInterview.update({
    where: { id: existing.id },
    data: {
      profileId: parsed.data.profileId,
      bidId: parsed.data.bidId === undefined ? undefined : bidId,
      company: parsed.data.company?.trim(),
      roleTitle: parsed.data.roleTitle?.trim(),
      status: parsed.data.status,
      notes: parsed.data.notes,
      scheduledAt:
        parsed.data.scheduledAt === undefined
          ? undefined
          : parsed.data.scheduledAt
            ? new Date(parsed.data.scheduledAt)
            : null,
      scheduleEndsAt:
        parsed.data.scheduleEndsAt === undefined
          ? undefined
          : parsed.data.scheduleEndsAt
            ? new Date(parsed.data.scheduleEndsAt)
            : null,
    },
  });
  return res.json({ data });
});

huntingRouter.delete("/interviews/:id", async (req, res) => {
  const existing = await prisma.huntingInterview.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  await deleteLinkedCalendarEvents(existing.userId, "HUNTING", existing.id);
  await prisma.huntingInterview.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

const interviewScheduleRouter = Router({ mergeParams: true });
attachScheduleRoutes(interviewScheduleRouter, "HUNTING");
huntingRouter.use("/interviews", interviewScheduleRouter);
huntingRouter.use("/progress", interviewProgressRouter);
