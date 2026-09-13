import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth";
import {
  DEFAULT_TIME_ZONE,
  addZonedDays,
  formatZonedDayHeader,
  formatZonedMonthYear,
  resolveAppTimeZone,
  startOfZonedMonth,
  startOfZonedWeek,
  toZonedDateInput,
  wallTimeToUtc,
  zonedParts,
} from "../lib/timezone";

export type PeriodType = "daily" | "weekly" | "monthly";

export const PERIODS: PeriodType[] = ["daily", "weekly", "monthly"];

/** Civil YYYY-MM-DD in the given zone (default Asia/Tokyo). */
export function toDateKey(d: Date, timeZone: string = DEFAULT_TIME_ZONE) {
  return toZonedDateInput(d.toISOString(), timeZone);
}

export function parseDateKey(key: string, timeZone: string = DEFAULT_TIME_ZONE) {
  const [y, m, day] = key.split("-").map(Number);
  return wallTimeToUtc(y, m, day, 0, 0, 0, timeZone);
}

export function periodLabel(
  period: PeriodType,
  anchor: Date,
  locale: string,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (period === "daily") return formatZonedDayHeader(anchor, locale, timeZone);
  if (period === "weekly") {
    const from = startOfZonedWeek(anchor, timeZone);
    const to = addZonedDays(from, 6, timeZone);
    return `${formatZonedDayHeader(from, locale, timeZone)} – ${formatZonedDayHeader(to, locale, timeZone)}`;
  }
  return formatZonedMonthYear(startOfZonedMonth(anchor, timeZone), locale, timeZone);
}

export function shiftAnchor(
  period: PeriodType,
  anchor: Date,
  dir: number,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (period === "daily") return addZonedDays(anchor, dir, timeZone);
  if (period === "weekly") return addZonedDays(anchor, dir * 7, timeZone);
  const p = zonedParts(anchor, timeZone);
  let y = p.year;
  let m = p.month + dir;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return wallTimeToUtc(y, m, 1, 0, 0, 0, timeZone);
}

type Props = {
  period: PeriodType;
  anchorKey: string;
  onPeriodChange: (period: PeriodType) => void;
  onAnchorKeyChange: (key: string) => void;
  labelKey?: string;
  timeZone?: string;
};

export function PeriodToolbar({
  period,
  anchorKey,
  onPeriodChange,
  onAnchorKeyChange,
  labelKey = "reports.periodLabel",
  timeZone: timeZoneProp,
}: Props) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const timeZone = resolveAppTimeZone(timeZoneProp ?? user?.timeZone);
  const anchor = useMemo(() => parseDateKey(anchorKey, timeZone), [anchorKey, timeZone]);
  const rangeLabel = useMemo(
    () => periodLabel(period, anchor, i18n.language, timeZone),
    [period, anchor, i18n.language, timeZone],
  );

  return (
    <div className="cal-toolbar reports-toolbar hunting-period-toolbar">
      <div className="cal-nav">
        <button
          className="btn"
          type="button"
          onClick={() => onAnchorKeyChange(toDateKey(new Date(), timeZone))}
        >
          {t("reports.today")}
        </button>
        <button
          className="btn ghost"
          type="button"
          aria-label={t("common.prev")}
          onClick={() =>
            onAnchorKeyChange(toDateKey(shiftAnchor(period, anchor, -1, timeZone), timeZone))
          }
        >
          ‹
        </button>
        <button
          className="btn ghost"
          type="button"
          aria-label={t("common.next")}
          onClick={() =>
            onAnchorKeyChange(toDateKey(shiftAnchor(period, anchor, 1, timeZone), timeZone))
          }
        >
          ›
        </button>
        {rangeLabel && <strong className="cal-period">{rangeLabel}</strong>}
      </div>
      <div className="cal-views" role="group" aria-label={t(labelKey)}>
        {PERIODS.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`btn${period === mode ? " primary" : " ghost"}`}
            onClick={() => onPeriodChange(mode)}
          >
            {t(`reports.period.${mode}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
