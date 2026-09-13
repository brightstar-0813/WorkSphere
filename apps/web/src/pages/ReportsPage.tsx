import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { buildProfileRegionLines } from "../lib/bidAmounts";
import { PageHeader } from "../components/PageHeader";
import { PageState } from "../components/PageState";
import { PeriodToolbar, toDateKey, type PeriodType } from "../components/PeriodToolbar";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { useAuth } from "../auth";
import { resolveAppTimeZone } from "../lib/timezone";

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
    country?: string;
    totalCount: number;
    amountsByCurrency: Record<string, number>;
    byStatus: Record<string, AmountBucket>;
  }>;
  byCountry?: Array<{
    country: string;
    totalCount: number;
    amountsByCurrency: Record<string, number>;
    byStatus: Record<string, AmountBucket>;
  }>;
};

type Summary = {
  period: { type: PeriodType; from: string; to: string; date: string };
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

function formatMoney(minor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const timeZone = resolveAppTimeZone(user?.timeZone);
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const [anchorKey, setAnchorKey] = useState(() => toDateKey(new Date(), timeZone));
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ period, date: anchorKey });
    void api<Summary>(`/reports/summary?${qs}`)
      .then((summary) => {
        if (!cancelled) setData(summary);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("common.error"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, anchorKey, t]);

  const interviews = data?.interviewsByStatus ?? {};
  const bidAmounts = data?.bidAmounts;
  const emptyAmount = t("reports.noAmount");

  const bidBreakdown = useMemo(() => {
    if (!bidAmounts?.byProfile?.length) return null;
    return buildProfileRegionLines(
      bidAmounts.byProfile.map((p) => ({
        profileId: p.profileId,
        profileName: p.profileName,
        amountsByCurrency: p.amountsByCurrency,
      })),
      i18n.language,
      emptyAmount,
    );
  }, [bidAmounts, i18n.language, emptyAmount]);

  return (
    <section className="page reports-page">
      <PageHeader title={t("reports.heading")} />

      <PeriodToolbar
        period={period}
        anchorKey={anchorKey}
        onPeriodChange={setPeriod}
        onAnchorKeyChange={setAnchorKey}
        timeZone={timeZone}
      />

      <PageState loading={loading && !data} error={error} empty={!loading && !data && !error} />

      {data && (
        <div className="reports-grid">
          <div className="panel">
            <h2>{t("reports.jobs")}</h2>
            {Object.keys(data.jobsByStatus).length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <ul className="reports-status-list">
                {Object.entries(data.jobsByStatus).map(([k, v]) => (
                  <li key={k}>
                    <StatusBadge tone={statusTone(k)}>
                      {t(`jobs.status.${k}`, { defaultValue: k })}
                    </StatusBadge>
                    <span className="tabular">{v}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <h2>{t("reports.bids")}</h2>
            {bidBreakdown ? (
              <div className="reports-bid-breakdown">
                <p className="tabular" translate="no">
                  {bidBreakdown.profilesLine}
                </p>
                <p className="tabular muted" translate="no">
                  {bidBreakdown.regionsLine}
                </p>
              </div>
            ) : (
              <p className="muted">{t("common.empty")}</p>
            )}
          </div>

          <div className="panel">
            <h2>{t("reports.interviews")}</h2>
            {Object.keys(interviews).length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <ul className="reports-status-list">
                {Object.entries(interviews).map(([k, v]) => (
                  <li key={k}>
                    <StatusBadge tone={statusTone(k)}>
                      {t(`hunting.interviews.status.${k}`, { defaultValue: k })}
                    </StatusBadge>
                    <span className="tabular">{v}</span>
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
            <h2>{t("reports.eventsInPeriod")}</h2>
            <p>{data.eventsInPeriod ?? data.upcomingEvents}</p>
          </div>
        </div>
      )}
    </section>
  );
}
