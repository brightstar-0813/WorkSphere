import { Router } from "express";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { countIcsScheduleEvents } from "../integrations/icsSync.js";
import {
  bidDateFilter,
  formatAnchorKey,
  interviewDateFilter,
  parseAnchorDate,
  parsePeriod,
  resolvePeriod,
} from "../period.js";
import { resolveActorTimeZone } from "../requestTimeZone.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

type AmountBucket = {
  count: number;
  amountsByCurrency: Record<string, number>;
};

function emptyBucket(): AmountBucket {
  return { count: 0, amountsByCurrency: {} };
}

function addAmount(bucket: AmountBucket, amountMinor: number | null, currency: string) {
  bucket.count += 1;
  if (amountMinor != null) {
    bucket.amountsByCurrency[currency] = (bucket.amountsByCurrency[currency] ?? 0) + amountMinor;
  }
}

reportsRouter.get("/summary", async (req, res) => {
  const where = ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  const scopeUserId = typeof where.userId === "string" ? where.userId : req.user!.id;
  const timeZone = await resolveActorTimeZone(req, scopeUserId);
  const period = parsePeriod(req.query.period);
  const anchor = parseAnchorDate(req.query.date, timeZone);
  const { from, to } = resolvePeriod(period, anchor, timeZone);
  const range = { gte: from, lt: to };

  const jobDateFilter = { createdAt: range };
  const txDateFilter = { occurredAt: range };
  const discussionDateFilter = { createdAt: range };
  const eventDateFilter = { startsAt: range };

  const chatWhere =
    typeof where.userId === "string"
      ? { authorId: where.userId, createdAt: range }
      : { createdAt: range };

  const [jobs, bids, interviews, transactions, discussions, chatMessages, events, icsSchedules] =
    await Promise.all([
    prisma.job.groupBy({
      by: ["status"],
      where: { ...where, ...jobDateFilter },
      _count: true,
    }),
    prisma.huntingBid.findMany({
      where: { ...where, ...bidDateFilter(range) },
      select: {
        status: true,
        amountMinor: true,
        currency: true,
        profileId: true,
        profile: { select: { id: true, name: true, country: true } },
      },
    }),
    prisma.huntingInterview.groupBy({
      by: ["status"],
      where: { ...where, ...interviewDateFilter(range) },
      _count: true,
    }),
    prisma.transaction.findMany({
      where: { ...where, ...txDateFilter },
      select: { type: true, amountMinor: true },
    }),
    prisma.discussion.count({ where: { ...where, ...discussionDateFilter } }),
    prisma.chatMessage.count({ where: chatWhere }),
    prisma.calendarEvent.count({
      where: {
        ...where,
        ...eventDateFilter,
      },
    }),
    countIcsScheduleEvents({
      userId: typeof where.userId === "string" ? where.userId : undefined,
      startsAt: range,
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
      country: string;
      totalCount: number;
      amountsByCurrency: Record<string, number>;
      byStatus: Record<string, AmountBucket>;
    }
  >();
  const countryMap = new Map<
    string,
    {
      country: string;
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
        country: bid.profile.country ?? "",
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

    const countryKey = (bid.profile.country ?? "").trim() || "";
    let countryBucket = countryMap.get(countryKey);
    if (!countryBucket) {
      countryBucket = {
        country: countryKey,
        totalCount: 0,
        amountsByCurrency: {},
        byStatus: {},
      };
      countryMap.set(countryKey, countryBucket);
    }
    if (!countryBucket.byStatus[bid.status]) countryBucket.byStatus[bid.status] = emptyBucket();
    addAmount(countryBucket.byStatus[bid.status], bid.amountMinor, bid.currency);
    countryBucket.totalCount += 1;
    if (bid.amountMinor != null) {
      countryBucket.amountsByCurrency[bid.currency] =
        (countryBucket.amountsByCurrency[bid.currency] ?? 0) + bid.amountMinor;
    }
  }

  const byProfile = [...profileMap.values()].sort((a, b) =>
    a.profileName.localeCompare(b.profileName)
  );
  const byCountry = [...countryMap.values()].sort((a, b) => {
    if (!a.country && b.country) return 1;
    if (a.country && !b.country) return -1;
    return a.country.localeCompare(b.country);
  });

  const interviewsByStatus = Object.fromEntries(interviews.map((i) => [i.status, i._count]));
  if (icsSchedules > 0) {
    interviewsByStatus.SCHEDULED = (interviewsByStatus.SCHEDULED ?? 0) + icsSchedules;
  }

  return res.json({
    data: {
      period: {
        type: period,
        from: from.toISOString(),
        to: to.toISOString(),
        date: formatAnchorKey(anchor, timeZone),
      },
      jobsByStatus: Object.fromEntries(jobs.map((j) => [j.status, j._count])),
      bidsByStatus,
      bidAmounts: {
        totalCount: bids.length,
        totalsByCurrency,
        byStatus,
        byProfile,
        byCountry,
      },
      interviewsByStatus,
      /** @deprecated use bidsByStatus */
      huntingByStage: bidsByStatus,
      money: { incomeMinor: income, expenseMinor: expense, netMinor: income - expense },
      discussionCount: discussions + chatMessages,
      chatMessageCount: chatMessages,
      upcomingEvents: events,
      eventsInPeriod: events,
    },
  });
});
