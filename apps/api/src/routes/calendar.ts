import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { expandEventsInRange, RECUR_FREQUENCIES, serializeRecurDays } from "../recur.js";
import { pushInviteToConnectedCalendars } from "../integrations/calendarSyncExternal.js";

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

const sourceEnum = z.enum([
  "JOB",
  "HUNTING",
  "TRANSACTION",
  "MANUAL",
  "GOOGLE",
  "OUTLOOK",
]);

const eventBody = z.object({
  title: z.string().min(1).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  description: z.string().optional(),
  tag: z.enum(["DEADLINE", "SCHEDULE"]).optional(),
  remindMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  alertEnabled: z.boolean().optional(),
  recur: z.enum(RECUR_FREQUENCIES).optional(),
  recurDays: z.array(z.number().int().min(0).max(6)).optional(),
  recurUntil: z.string().datetime().nullable().optional(),
  sourceType: sourceEnum.optional(),
  sourceId: z.string().nullable().optional(),
  attendees: z.array(z.string().email()).optional(),
  inviteVia: z.enum(["AUTO", "GOOGLE", "OUTLOOK", "NONE"]).optional(),
});

type SourceFilter = "JOB" | "HUNTING" | "TRANSACTION" | "MANUAL" | "GOOGLE" | "OUTLOOK";

async function acceptedShareOwnerIds(requesterId: string) {
  const shares = await prisma.calendarShare.findMany({
    where: { requesterId, status: "ACCEPTED", ownerId: { not: null } },
    select: {
      ownerId: true,
      owner: { select: { id: true, email: true, name: true } },
    },
  });
  return shares
    .map((s) => s.owner)
    .filter((o): o is { id: string; email: string; name: string } => Boolean(o));
}

function serializeExpanded(
  stored: Parameters<typeof expandEventsInRange>[0],
  from: Date,
  to: Date,
  sharedFrom: { id: string; email: string; name: string } | null
) {
  return expandEventsInRange(stored, from, to).map((ev) => ({
    ...ev,
    id: sharedFrom ? `shared:${sharedFrom.id}:${ev.occurrenceKey}` : ev.occurrenceKey,
    seriesId: ev.seriesId,
    startsAt: ev.startsAt.toISOString(),
    endsAt: ev.endsAt ? ev.endsAt.toISOString() : null,
    recurUntil: ev.recurUntil ? ev.recurUntil.toISOString() : null,
    sharedFrom,
    readOnly: Boolean(sharedFrom),
  }));
}

calendarRouter.get("/", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const typesRaw = typeof req.query.types === "string" ? req.query.types : "";
  const types = typesRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean) as SourceFilter[];
  const jobIds = (typeof req.query.jobIds === "string" ? req.query.jobIds : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const profileIds = (typeof req.query.profileIds === "string" ? req.query.profileIds : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const shareOwnerIds = (typeof req.query.shareOwnerIds === "string" ? req.query.shareOwnerIds : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const entityFilter = jobIds.length > 0 || profileIds.length > 0;
  const includeShared =
    shareOwnerIds.length > 0 ||
    (req.query.shared !== "0" && req.query.shared !== "false");
  const shareViewerId =
    req.user!.role === "ADMIN" && typeof req.query.userId === "string"
      ? req.query.userId
      : req.user!.id;

  let huntingSourceIds: string[] = [];
  const interviewToProfile = new Map<string, string>();
  if (profileIds.length > 0) {
    const interviews = await prisma.huntingInterview.findMany({
      where: { ...where, profileId: { in: profileIds } },
      select: { id: true, profileId: true },
    });
    for (const row of interviews) interviewToProfile.set(row.id, row.profileId);
    huntingSourceIds = [...new Set([...profileIds, ...interviews.map((i) => i.id)])];
  }

  function layerKeyFor(ev: { sourceType: string; sourceId: string | null }): string | null {
    if (ev.sourceType === "JOB" && ev.sourceId) return `job:${ev.sourceId}`;
    if (ev.sourceType === "HUNTING" && ev.sourceId) {
      if (profileIds.includes(ev.sourceId)) return `profile:${ev.sourceId}`;
      const profileId = interviewToProfile.get(ev.sourceId);
      return profileId ? `profile:${profileId}` : null;
    }
    return null;
  }

  const entityOr =
    entityFilter
      ? [
          ...(jobIds.length > 0
            ? [{ sourceType: "JOB" as const, sourceId: { in: jobIds } }]
            : []),
          ...(huntingSourceIds.length > 0
            ? [{ sourceType: "HUNTING" as const, sourceId: { in: huntingSourceIds } }]
            : []),
        ]
      : [];

  const typeFilter =
    !entityFilter && types.length > 0
      ? {
          sourceType: {
            in: types,
          },
        }
      : {};

  const skipOwn =
    (entityFilter && entityOr.length === 0 && types.length === 0) ||
    (!entityFilter && types.length === 0 && shareOwnerIds.length > 0);

  const baseWhere = {
    ...where,
    ...typeFilter,
    ...(entityOr.length > 0 ? { OR: entityOr } : {}),
  };

  const allAccepted = includeShared ? await acceptedShareOwnerIds(shareViewerId) : [];
  const owners =
    shareOwnerIds.length > 0
      ? allAccepted.filter((o) => shareOwnerIds.includes(o.id))
      : allAccepted;

  if (!from || !to) {
    const own = skipOwn
      ? []
      : await prisma.calendarEvent.findMany({
          where: baseWhere,
          orderBy: { startsAt: "asc" },
        });
    const sharedRows =
      owners.length === 0
        ? []
        : await prisma.calendarEvent.findMany({
            where: {
              userId: { in: owners.map((o) => o.id) },
            },
            orderBy: { startsAt: "asc" },
          });
    const ownerMap = new Map(owners.map((o) => [o.id, o]));
    return res.json({
      data: [
        ...own.map((ev) => ({
          ...ev,
          layerKey: layerKeyFor(ev),
          sharedFrom: null,
          readOnly: false,
        })),
        ...sharedRows.map((ev) => ({
          ...ev,
          id: `shared:${ev.userId}:${ev.id}`,
          layerKey: `share:${ev.userId}`,
          sharedFrom: ownerMap.get(ev.userId) ?? null,
          readOnly: true,
        })),
      ],
    });
  }

  // When combining entity OR with recur OR, Prisma needs AND grouping
  const ownStoredFixed = skipOwn
    ? []
    : await prisma.calendarEvent.findMany({
        where: {
          AND: [
            where,
            ...(entityOr.length > 0
              ? [{ OR: entityOr }]
              : types.length > 0
                ? [{ sourceType: { in: types } }]
                : []),
            {
              OR: [
                { recur: "ONCE", startsAt: { gte: from, lte: to } },
                {
                  NOT: { recur: "ONCE" },
                  startsAt: { lte: to },
                  OR: [{ recurUntil: null }, { recurUntil: { gte: from } }],
                },
              ],
            },
          ],
        },
        orderBy: { startsAt: "asc" },
      });

  const sharedStored =
    owners.length === 0
      ? []
      : await prisma.calendarEvent.findMany({
          where: {
            AND: [
              { userId: { in: owners.map((o) => o.id) } },
              {
                OR: [
                  { recur: "ONCE", startsAt: { gte: from, lte: to } },
                  {
                    NOT: { recur: "ONCE" },
                    startsAt: { lte: to },
                    OR: [{ recurUntil: null }, { recurUntil: { gte: from } }],
                  },
                ],
              },
            ],
          },
          orderBy: { startsAt: "asc" },
        });

  const ownerMap = new Map(owners.map((o) => [o.id, o]));
  const data = [
    ...serializeExpanded(ownStoredFixed, from, to, null).map((ev) => ({
      ...ev,
      layerKey: layerKeyFor(ev),
    })),
    ...sharedStored.flatMap((ev) =>
      serializeExpanded([ev], from, to, ownerMap.get(ev.userId) ?? null).map((row) => ({
        ...row,
        layerKey: `share:${ev.userId}`,
      }))
    ),
  ];

  return res.json({ data });
});

calendarRouter.get("/upcoming-alerts", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const horizonMin = Math.min(
    24 * 60,
    Math.max(30, Number(req.query.horizonMinutes ?? 12 * 60) || 12 * 60)
  );
  const now = new Date();
  const until = new Date(now.getTime() + horizonMin * 60 * 1000);

  const stored = await prisma.calendarEvent.findMany({
    where: {
      ...where,
      alertEnabled: true,
      OR: [
        { recur: "ONCE", startsAt: { gte: now, lte: until } },
        {
          NOT: { recur: "ONCE" },
          startsAt: { lte: until },
          OR: [{ recurUntil: null }, { recurUntil: { gte: now } }],
        },
      ],
    },
    orderBy: { startsAt: "asc" },
  });

  const data = expandEventsInRange(stored, now, until)
    .filter((ev) => ev.startsAt >= now && ev.startsAt <= until)
    .map((ev) => ({
      ...ev,
      id: ev.occurrenceKey,
      seriesId: ev.seriesId,
      startsAt: ev.startsAt.toISOString(),
      endsAt: ev.endsAt ? ev.endsAt.toISOString() : null,
      recurUntil: ev.recurUntil ? ev.recurUntil.toISOString() : null,
    }));

  return res.json({ data });
});

calendarRouter.post("/", async (req, res) => {
  const parsed = eventBody
    .extend({
      title: z.string().min(1),
      startsAt: z.string().datetime(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const startsAt = new Date(parsed.data.startsAt);
  let endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (!endsAt && !parsed.data.allDay) {
    endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  }

  const attendees = parsed.data.attendees ?? [];
  const inviteVia = parsed.data.inviteVia ?? (attendees.length ? "AUTO" : "NONE");

  let externalId: string | null = null;
  let htmlLink: string | null = null;
  let sourceType = parsed.data.sourceType ?? "MANUAL";

  if (inviteVia !== "NONE") {
    try {
      const pushed = await pushInviteToConnectedCalendars(req.user!.id, {
        title: parsed.data.title,
        description: parsed.data.description,
        startsAt,
        endsAt,
        allDay: parsed.data.allDay,
        attendees,
        prefer: inviteVia === "AUTO" ? "AUTO" : inviteVia,
      });
      if (pushed) {
        externalId = pushed.externalId;
        htmlLink = pushed.htmlLink;
        sourceType = pushed.provider;
      }
    } catch (err) {
      console.error("External invite failed", err);
      return res.status(502).json({
        error: {
          code: "INVITE_FAILED",
          message: err instanceof Error ? err.message : "Failed to send calendar invite",
        },
      });
    }
  }

  const recur = parsed.data.recur ?? "ONCE";
  const recurDays =
    recur === "CUSTOM" ? serializeRecurDays(parsed.data.recurDays ?? []) : "";
  if (recur === "CUSTOM" && !recurDays) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Custom repeat requires at least one weekday" },
    });
  }

  const data = await prisma.calendarEvent.create({
    data: {
      userId: req.user!.id,
      title: parsed.data.title,
      startsAt,
      endsAt,
      allDay: parsed.data.allDay ?? false,
      description: parsed.data.description ?? "",
      tag: parsed.data.tag ?? "SCHEDULE",
      remindMinutes: parsed.data.remindMinutes ?? 30,
      alertEnabled: parsed.data.alertEnabled ?? true,
      recur,
      recurDays,
      recurUntil: parsed.data.recurUntil ? new Date(parsed.data.recurUntil) : null,
      sourceType,
      sourceId: parsed.data.sourceId ?? null,
      externalId,
      attendees: attendees.join(","),
      htmlLink,
    },
  });
  return res.status(201).json({ data });
});

calendarRouter.patch("/:id", async (req, res) => {
  const rawId = req.params.id;
  const seriesId = rawId.includes(":") ? rawId.split(":")[0]! : rawId;
  const existing = await prisma.calendarEvent.findUnique({ where: { id: seriesId } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }
  const parsed = eventBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const nextRecur = parsed.data.recur ?? existing.recur;
  let nextRecurDays: string | undefined;
  if (parsed.data.recur !== undefined || parsed.data.recurDays !== undefined) {
    if (nextRecur === "CUSTOM") {
      nextRecurDays = serializeRecurDays(
        parsed.data.recurDays ??
          existing.recurDays
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      );
      if (!nextRecurDays) {
        return res.status(400).json({
          error: { code: "VALIDATION", message: "Custom repeat requires at least one weekday" },
        });
      }
    } else {
      nextRecurDays = "";
    }
  }

  const data = await prisma.calendarEvent.update({
    where: { id: existing.id },
    data: {
      title: parsed.data.title,
      allDay: parsed.data.allDay,
      description: parsed.data.description,
      tag: parsed.data.tag,
      remindMinutes:
        parsed.data.remindMinutes === undefined
          ? undefined
          : parsed.data.remindMinutes ?? 30,
      alertEnabled: parsed.data.alertEnabled,
      recur: parsed.data.recur,
      recurDays: nextRecurDays,
      recurUntil:
        parsed.data.recurUntil === undefined
          ? undefined
          : parsed.data.recurUntil
            ? new Date(parsed.data.recurUntil)
            : null,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
      endsAt:
        parsed.data.endsAt === undefined
          ? undefined
          : parsed.data.endsAt
            ? new Date(parsed.data.endsAt)
            : null,
      attendees:
        parsed.data.attendees === undefined
          ? undefined
          : parsed.data.attendees.join(","),
    },
  });

  if (existing.sourceType === "JOB" && existing.sourceId && existing.tag === "DEADLINE") {
    await prisma.job.updateMany({
      where: { id: existing.sourceId, userId: existing.userId },
      data: { dueAt: data.startsAt },
    });
  }

  return res.json({ data });
});

calendarRouter.delete("/:id", async (req, res) => {
  const rawId = req.params.id;
  const seriesId = rawId.includes(":") ? rawId.split(":")[0]! : rawId;

  const existing = await prisma.calendarEvent.findUnique({ where: { id: seriesId } });
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.id) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  }

  if (existing.sourceType === "JOB" && existing.sourceId && existing.tag === "DEADLINE") {
    await prisma.job.updateMany({
      where: { id: existing.sourceId, userId: existing.userId },
      data: { dueAt: null },
    });
  }

  await prisma.calendarEvent.delete({ where: { id: existing.id } });
  return res.status(204).send();
});
