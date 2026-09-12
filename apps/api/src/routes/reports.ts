import { Router } from "express";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

type PeriodType = "daily" | "weekly" | "monthly" | "all";

type AmountBucket = {
  count: number;
  amountsByCurrency: Record<string, number>;
};

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function parseAnchorDate(raw: unknown): Date {
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, day] = raw.split("-").map(Number);
    return new Date(y, m - 1, day, 0, 0, 0, 0);
  }
  return startOfLocalDay(new Date());
}

function resolvePeriod(period: PeriodType, anchor: Date): { from: Date | null; to: Date | null } {
  if (period === "all") return { from: null, to: null };

  const dayStart = startOfLocalDay(anchor);
  if (period === "daily") {
    return { from: dayStart, to: addDays(dayStart, 1) };
  }
  if (period === "weekly") {
    const weekStart = addDays(dayStart, -dayStart.getDay());
    return { from: weekStart, to: addDays(weekStart, 7) };
  }
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const monthEnd = new Date(dayStart.getFullYear(), dayStart.getMonth() + 1, 1);
  return { from: monthStart, to: monthEnd };
}

function emptyBucket(): AmountBucket {
  return { count: 0, amountsByCurrency: {} };
}

function addAmount(bucket: AmountBucket, amountMinor: number | null, currency: string) {
  bucket.count += 1;
  if (amountMinor != null) {
    bucket.amountsByCurrency[currency] = (bucket.amountsByCurrency[currency] ?? 0) + amountMinor;
  }
}

function parsePeriod(raw: unknown): PeriodType {
  if (raw === "daily" || raw === "day") return "daily";
  if (raw === "weekly" || raw === "week") return "weekly";
  if (raw === "monthly" || raw === "month") return "monthly";
  return "all";
}

reportsRouter.get("/summary", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const period = parsePeriod(req.query.period);
  const anchor = parseAnchorDate(req.query.date);
  const { from, to } = resolvePeriod(period, anchor);
  const range = from && to ? { gte: from, lt: to } : null;

  const bidDateFilter = range
    ? {
        OR: [
          { appliedAt: range },
          { AND: [{ appliedAt: null }, { createdAt: range }] },
        ],
      }
    : {};

  const interviewDateFilter = range
    ? {
        OR: [
          { scheduledAt: range },
          { AND: [{ scheduledAt: null }, { createdAt: range }] },
        ],
      }
    : {};

  const jobDateFilter = range ? { createdAt: range } : {};
  const txDateFilter = range ? { occurredAt: range } : {};
  const discussionDateFilter = range ? { createdAt: range } : {};
  const eventDateFilter = range
    ? { startsAt: range }
    : { startsAt: { gte: new Date() } };

  const [jobs, bids, interviews, transactions, discussions, events] = await Promise.all([
    prisma.job.groupBy({
      by: ["status"],
      where: { ...where, ...jobDateFilter },
      _count: true,
    }),
    prisma.huntingBid.findMany({
      where: { ...where, ...bidDateFilter },
      select: {
        status: true,
        amountMinor: true,
        currency: true,
        profileId: true,
        profile: { select: { id: true, name: true } },
      },
    }),
    prisma.huntingInterview.groupBy({
      by: ["status"],
      where: { ...where, ...interviewDateFilter },
      _count: true,
    }),
    prisma.transaction.findMany({
      where: { ...where, ...txDateFilter },
      select: { type: true, amountMinor: true },
    }),
    prisma.discussion.count({ where: { ...where, ...discussionDateFilter } }),
    prisma.calendarEvent.count({
      where: {
        ...where,
        ...eventDateFilter,
      },
    }),
  ]);

  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.type === "INCOME") income += t.amountMinor;
    else expense += t.amountMinor;
  }

  const bidsByStatus: Record<string, number> = {};
  const byStatus: Record<string, AmountBucket> = {};
  const totalsByCurrency: Record<string, number> = {};
  const profileMap = new Map<
    string,
    {
      profileId: string;
      profileName: string;
      totalCount: number;
      amountsByCurrency: Record<string, number>;
      byStatus: Record<string, AmountBucket>;
    }
  >();

  for (const bid of bids) {
    bidsByStatus[bid.status] = (bidsByStatus[bid.status] ?? 0) + 1;

    if (!byStatus[bid.status]) byStatus[bid.status] = emptyBucket();
    addAmount(byStatus[bid.status], bid.amountMinor, bid.currency);

    if (bid.amountMinor != null) {
      totalsByCurrency[bid.currency] = (totalsByCurrency[bid.currency] ?? 0) + bid.amountMinor;
    }

    let profile = profileMap.get(bid.profileId);
    if (!profile) {
      profile = {
        profileId: bid.profile.id,
        profileName: bid.profile.name,
        totalCount: 0,
        amountsByCurrency: {},
        byStatus: {},
      };
      profileMap.set(bid.profileId, profile);
    }
    if (!profile.byStatus[bid.status]) profile.byStatus[bid.status] = emptyBucket();
    addAmount(profile.byStatus[bid.status], bid.amountMinor, bid.currency);
    profile.totalCount += 1;
    if (bid.amountMinor != null) {
      profile.amountsByCurrency[bid.currency] =
        (profile.amountsByCurrency[bid.currency] ?? 0) + bid.amountMinor;
    }
  }

  const byProfile = [...profileMap.values()].sort((a, b) =>
    a.profileName.localeCompare(b.profileName)
  );

  return res.json({
    data: {
      period: {
        type: period,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        date: `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(anchor.getDate()).padStart(2, "0")}`,
      },
      jobsByStatus: Object.fromEntries(jobs.map((j) => [j.status, j._count])),
      bidsByStatus,
      bidAmounts: {
        totalCount: bids.length,
        totalsByCurrency,
        byStatus,
        byProfile,
      },
      interviewsByStatus: Object.fromEntries(interviews.map((i) => [i.status, i._count])),
      /** @deprecated use bidsByStatus */
      huntingByStage: bidsByStatus,
      money: { incomeMinor: income, expenseMinor: expense, netMinor: income - expense },
      discussionCount: discussions,
      upcomingEvents: events,
      eventsInPeriod: events,
    },
  });
});
