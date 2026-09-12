import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { addDays, endOfDay, formatDayHeader, formatMonthYear, startOfMonth, startOfWeek } from "../lib/datetime";

type PeriodType = "daily" | "weekly" | "monthly" | "all";

type AmountBucket = {
  count: number;
  amountsByCurrency: Record<string, number>;
};

type BidAmounts = {
  totalCount: number;
  totalsByCurrency: Record<string, number>;
  byStatus: Record<string, AmountBucket>;
  byProfile: Array<{
    profileId: string;
    profileName: string;
    totalCount: number;
    amountsByCurrency: Record<string, number>;
    byStatus: Record<string, AmountBucket>;
  }>;
};

type Summary = {
  period: { type: PeriodType; from: string | null; to: string | null; date: string };
  jobsByStatus: Record<string, number>;
  bidsByStatus?: Record<string, number>;
  interviewsByStatus?: Record<string, number>;
  huntingByStage: Record<string, number>;
  bidAmounts?: BidAmounts;
  money: { incomeMinor: number; expenseMinor: number; netMinor: number };
  discussionCount: number;
  upcomingEvents: number;
  eventsInPeriod?: number;
};

const PERIODS: PeriodType[] = ["daily", "weekly", "monthly", "all"];

function formatMoney(minor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

function formatAmounts(map: Record<string, number>, locale: string, emptyLabel: string) {
  const entries = Object.entries(map);
  if (entries.length === 0) return emptyLabel;
  return entries.map(([currency, minor]) => formatMoney(minor, currency, locale)).join(" · ");
}

function toDateKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateKey(key: string) {
  const [y, m, day] = key.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function periodLabel(period: PeriodType, anchor: Date, locale: string) {
  if (period === "all") return null;
  if (period === "daily") return formatDayHeader(anchor, locale);
  if (period === "weekly") {
    const from = startOfWeek(anchor);
    const to = endOfDay(addDays(from, 6));
    return `${formatDayHeader(from, locale)} – ${formatDayHeader(to, locale)}`;
  }
  return formatMonthYear(startOfMonth(anchor), locale);
}

function shiftAnchor(period: PeriodType, anchor: Date, dir: number) {
  if (period === "daily") return addDays(anchor, dir);
  if (period === "weekly") return addDays(anchor, dir * 7);
  if (period === "monthly") return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return anchor;
}

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const [anchorKey, setAnchorKey] = useState(() => toDateKey(new Date()));
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const anchor = useMemo(() => parseDateKey(anchorKey), [anchorKey]);
  const rangeLabel = useMemo(
    () => periodLabel(period, anchor, i18n.language),
    [period, anchor, i18n.language]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ period });
    if (period !== "all") qs.set("date", anchorKey);
    void api<Summary>(`/reports/summary?${qs}`)
      .then((summary) => {
        if (!cancelled) setData(summary);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, anchorKey]);

  const bids = data?.bidsByStatus ?? data?.huntingByStage ?? {};
  const interviews = data?.interviewsByStatus ?? {};
  const bidAmounts = data?.bidAmounts;
  const emptyAmount = t("reports.noAmount");

  return (
    <section className="page reports-page">
      <div className="page-header">
        <div>
          <h1>{t("reports.heading")}</h1>
          <p className="muted">{t("reports.subtitle")}</p>
        </div>
      </div>

      <div className="cal-toolbar reports-toolbar">
        <div className="cal-nav">
          {period !== "all" && (
            <>
              <button className="btn" type="button" onClick={() => setAnchorKey(toDateKey(new Date()))}>
                {t("reports.today")}
              </button>
              <button
                className="btn ghost"
                type="button"
                aria-label={t("common.prev")}
                onClick={() => setAnchorKey(toDateKey(shiftAnchor(period, anchor, -1)))}
              >
                ‹
              </button>
              <button
                className="btn ghost"
                type="button"
                aria-label={t("common.next")}
                onClick={() => setAnchorKey(toDateKey(shiftAnchor(period, anchor, 1)))}
              >
                ›
              </button>
              {rangeLabel && <strong className="cal-period">{rangeLabel}</strong>}
            </>
          )}
          {period === "all" && <strong className="cal-period">{t("reports.period.all")}</strong>}
        </div>
        <div className="cal-views" role="group" aria-label={t("reports.periodLabel")}>
          {PERIODS.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn${period === mode ? " primary" : " ghost"}`}
              onClick={() => setPeriod(mode)}
            >
              {t(`reports.period.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <p className="muted">{t("common.loading")}</p>}

      {data && (
        <div className="grid">
          <div className="panel">
            <h2>{t("reports.jobs")}</h2>
            {Object.keys(data.jobsByStatus).length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <ul>
                {Object.entries(data.jobsByStatus).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <h2>{t("reports.bids")}</h2>
            {Object.keys(bids).length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <ul>
                {Object.entries(bids).map(([k, v]) => (
                  <li key={k}>
                    {t(`hunting.bids.status.${k}`, { defaultValue: k })}: {v}
                  </li>
                ))}
              </ul>
            )}
            {bidAmounts && (
              <p className="reports-total tabular">
                {t("reports.bidTotalCount", { count: bidAmounts.totalCount })}
                {" · "}
                {formatAmounts(bidAmounts.totalsByCurrency, i18n.language, emptyAmount)}
              </p>
            )}
          </div>

          <div className="panel">
            <h2>{t("reports.interviews")}</h2>
            {Object.keys(interviews).length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <ul>
                {Object.entries(interviews).map(([k, v]) => (
                  <li key={k}>
                    {t(`hunting.interviews.status.${k}`, { defaultValue: k })}: {v}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <h2>{t("reports.money")}</h2>
            <p>
              {t("common.income")}: {formatMoney(data.money.incomeMinor, "USD", i18n.language)}
            </p>
            <p>
              {t("common.expense")}: {formatMoney(data.money.expenseMinor, "USD", i18n.language)}
            </p>
            <p>
              {t("money.net")}: {formatMoney(data.money.netMinor, "USD", i18n.language)}
            </p>
          </div>

          <div className="panel">
            <h2>{t("reports.discussions")}</h2>
            <p>{data.discussionCount}</p>
            <h2>{period === "all" ? t("reports.upcoming") : t("reports.eventsInPeriod")}</h2>
            <p>{data.eventsInPeriod ?? data.upcomingEvents}</p>
          </div>
        </div>
      )}

      {data?.bidAmounts && (
        <div className="reports-bid-section stack">
          <div className="panel">
            <h2>{t("reports.bidAmountsByStatus")}</h2>
            {Object.keys(data.bidAmounts.byStatus).length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>{t("common.status")}</th>
                      <th className="tabular">{t("reports.count")}</th>
                      <th className="tabular">{t("reports.bidAmount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.bidAmounts.byStatus).map(([status, bucket]) => (
                      <tr key={status}>
                        <td>{t(`hunting.bids.status.${status}`, { defaultValue: status })}</td>
                        <td className="tabular">{bucket.count}</td>
                        <td className="tabular">
                          {formatAmounts(bucket.amountsByCurrency, i18n.language, emptyAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>{t("reports.total")}</th>
                      <th className="tabular">{data.bidAmounts.totalCount}</th>
                      <th className="tabular">
                        {formatAmounts(data.bidAmounts.totalsByCurrency, i18n.language, emptyAmount)}
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>{t("reports.bidAmountsByProfile")}</h2>
            {data.bidAmounts.byProfile.length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <div className="stack">
                {data.bidAmounts.byProfile.map((profile) => (
                  <div key={profile.profileId} className="reports-profile-block">
                    <div className="reports-profile-head">
                      <h3 translate="no">{profile.profileName}</h3>
                      <p className="muted small tabular">
                        {t("reports.bidTotalCount", { count: profile.totalCount })}
                        {" · "}
                        {formatAmounts(profile.amountsByCurrency, i18n.language, emptyAmount)}
                      </p>
                    </div>
                    <div className="reports-table-wrap">
                      <table className="reports-table">
                        <thead>
                          <tr>
                            <th>{t("common.status")}</th>
                            <th className="tabular">{t("reports.count")}</th>
                            <th className="tabular">{t("reports.bidAmount")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(profile.byStatus).map(([status, bucket]) => (
                            <tr key={status}>
                              <td>{t(`hunting.bids.status.${status}`, { defaultValue: status })}</td>
                              <td className="tabular">{bucket.count}</td>
                              <td className="tabular">
                                {formatAmounts(bucket.amountsByCurrency, i18n.language, emptyAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
