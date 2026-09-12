import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { createScheduleEvent, deleteLinkedCalendarEvents } from "../calendarSync.js";
import { listMeta, parsePagination } from "../pagination.js";
import { attachScheduleRoutes } from "./schedules.js";
import {
  appendJobToSpreadsheet,
  fetchSheetJobRows,
  mapSheetStatusToBidStatus,
  markJobAppliedOnSpreadsheet,
  normalizeJobLink,
  sheetStatusLooksReady,
} from "../integrations/bidSheet.js";
import {
  fetchJobsFromCaptureBot,
  normalizeCaptureBotUrl,
  parseCaptureCsv,
  type CaptureJobInput,
} from "../integrations/captureBot.js";

export const huntingRouter = Router();
huntingRouter.use(requireAuth);

const optionalUrl = z.union([z.string().url(), z.literal(""), z.null()]).optional();

const profileBody = z.object({
  name: z.string().min(1).optional(),
  label: z.string().optional(),
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
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const activeOnly = req.query.active === "true";
  const data = await prisma.huntingProfile.findMany({
    where: {
      ...where,
      ...(activeOnly ? { active: true } : {}),
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
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
              bidStatus === "SENT" || bidStatus === "SHORTLISTED" || bidStatus === "WON"
                ? existingBid.appliedAt ?? new Date()
                : existingBid.appliedAt,
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
            appliedAt:
              bidStatus === "SENT" || bidStatus === "SHORTLISTED" || bidStatus === "WON"
                ? new Date()
                : null,
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
  jobs: CaptureJobInput[]
) {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const job of jobs) {
    const existing = await prisma.capturedJob.findFirst({
      where: { profileId: profile.id, externalId: job.externalId },
    });
    if (existing) {
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
          userId: profile.userId,
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
  const check = await assertProfileOwned(req.params.id, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const csvText = typeof req.body?.csv === "string" ? req.body.csv : "";
  if (!csvText.trim()) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Body must include csv text (sf-job-capture jobs_latest.csv)." },
    });
  }

  try {
    const jobs = parseCaptureCsv(csvText);
    const meta = await upsertCapturedJobs(check.profile!, jobs);
    return res.json({ data: { meta } });
  } catch (err) {
    return res.status(400).json({
      error: {
        code: "VALIDATION",
        message: err instanceof Error ? err.message : "CSV import failed",
      },
    });
  }
});

/* ── Job fetch (CapturedJob) ──────────────────────────────── */

huntingRouter.get("/fetch", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
  const statusParsed = z.enum(capturedStatuses).safeParse(req.query.status);
  const openOnly = req.query.open === "true";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);

  const baseWhere: Prisma.CapturedJobWhereInput = {
    ...where,
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
  const check = await assertProfileOwned(parsed.data.profileId, req.user!.id, req.user!.role);
  if ("error" in check && check.error === "NOT_FOUND") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
  }
  if ("error" in check && check.error === "FORBIDDEN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }

  const sourceUrl = parsed.data.sourceUrl || null;
  const externalId = sourceUrl ? normalizeJobLink(sourceUrl) : null;
  if (externalId) {
    const dup = await prisma.capturedJob.findFirst({
      where: { profileId: parsed.data.profileId, externalId },
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
  });
  return res.status(201).json({ data });
});

huntingRouter.patch("/fetch/:id", async (req, res) => {
  const existing = await prisma.capturedJob.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
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
  });
  return res.json({ data });
});

huntingRouter.delete("/fetch/:id", async (req, res) => {
  const existing = await prisma.capturedJob.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  await prisma.capturedJob.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

huntingRouter.post("/fetch/:id/promote", async (req, res) => {
  const existing = await prisma.capturedJob.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }

  const pushToSheet = Boolean(req.body?.pushToSheet);
  const sheetKey = existing.externalId || (existing.sourceUrl ? normalizeJobLink(existing.sourceUrl) : null);

  let bid = sheetKey
    ? await prisma.huntingBid.findFirst({ where: { profileId: existing.profileId, sheetKey } })
    : null;

  if (!bid) {
    bid = await prisma.huntingBid.create({
      data: {
        userId: existing.userId,
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

  const baseWhere: Prisma.HuntingBidWhereInput = {
    ...where,
    ...(profileId ? { profileId } : {}),
  };
  const listWhere: Prisma.HuntingBidWhereInput = {
    ...baseWhere,
    ...(statusParsed.success ? { status: statusParsed.data } : {}),
    ...(q
      ? {
          OR: [
            { company: { contains: q, mode: "insensitive" } },
            { roleTitle: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
            { salary: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
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

huntingRouter.get("/interviews", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
  const statusParsed = z.enum(interviewStatuses).safeParse(req.query.status);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>);

  const baseWhere: Prisma.HuntingInterviewWhereInput = {
    ...where,
    ...(profileId ? { profileId } : {}),
  };
  const listWhere: Prisma.HuntingInterviewWhereInput = {
    ...baseWhere,
    ...(statusParsed.success ? { status: statusParsed.data } : {}),
    ...(q
      ? {
          OR: [
            { company: { contains: q, mode: "insensitive" } },
            { roleTitle: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, data, statusGroups] = await Promise.all([
    prisma.huntingInterview.count({ where: listWhere }),
    prisma.huntingInterview.findMany({
      where: listWhere,
      orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
      skip,
      take,
    }),
    prisma.huntingInterview.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const countsByStatus = Object.fromEntries(
    interviewStatuses.map((s) => [s, statusGroups.find((g) => g.status === s)?._count._all ?? 0]),
  ) as Record<(typeof interviewStatuses)[number], number>;

  return res.json({
    data,
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
