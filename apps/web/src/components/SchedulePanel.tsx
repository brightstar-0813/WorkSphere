import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { fromLocalInput, toLocalDateInput, toLocalInput } from "../lib/datetime";
import type { CalEvent, RecurFrequency } from "../types/calendar";

type Props = {
  source: "jobs" | "hunting";
  sourceId: string;
  defaultTitle?: string;
  /** YYYY-MM-DD — when set, list/add focuses on that day */
  focusDate?: string;
  onChanged?: () => void;
  compact?: boolean;
};

const RECUR_OPTIONS: RecurFrequency[] = [
  "ONCE",
  "DAILY",
  "WEEKDAYS",
  "WEEKLY",
  "MONTHLY",
  "CUSTOM",
];

/** JS Date.getDay() order: Sun…Sat */
const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;

/** 15-minute steps — clearer than native datetime-local spinners. */
const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

function parseRecurDays(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    ),
  ].sort((a, b) => a - b);
}

function weekdayLabel(day: number, locale: string) {
  const d = new Date(Date.UTC(2024, 0, 7 + day));
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(d);
}

function formatCustomDays(days: number[], locale: string) {
  return days.map((d) => weekdayLabel(d, locale)).join(", ");
}

function splitLocal(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [date = "", timePart = ""] = value.split("T");
  const time = timePart.slice(0, 5);
  return { date, time };
}

function joinLocal(date: string, time: string): string {
  if (!date || !time) return "";
  return `${date}T${time}`;
}

/** Snap arbitrary HH:mm to nearest 15-minute option. */
function snapTime(time: string): string {
  if (!time) return "09:00";
  const [hs = "0", ms = "0"] = time.split(":");
  const total = Number(hs) * 60 + Number(ms);
  if (!Number.isFinite(total)) return "09:00";
  const snapped = Math.round(total / 15) * 15;
  const clamped = ((snapped % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeOption(time: string, locale: string) {
  const [hs = "0", ms = "0"] = time.split(":");
  const d = new Date();
  d.setHours(Number(hs), Number(ms), 0, 0);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(d);
}

function formatRange(ev: CalEvent, locale: string) {
  const start = new Date(ev.startsAt);
  if (ev.allDay) return start.toLocaleDateString(locale);
  const end = ev.endsAt ? new Date(ev.endsAt) : null;
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (!end) return start.toLocaleString(locale, { ...opts, month: "short", day: "numeric" });
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${start.toLocaleDateString(locale, { month: "short", day: "numeric" })} · ${start.toLocaleTimeString(locale, opts)} – ${end.toLocaleTimeString(locale, opts)}`;
  }
  return `${start.toLocaleString(locale)} – ${end.toLocaleString(locale)}`;
}

function onFocusDay(iso: string, focusDate?: string) {
  if (!focusDate) return true;
  return toLocalDateInput(iso) === focusDate;
}

function occursOnFocus(ev: CalEvent, focusDate: string) {
  if ((ev.recur || "ONCE") === "ONCE") return onFocusDay(ev.startsAt, focusDate);
  const startDay = toLocalDateInput(ev.startsAt);
  if (focusDate < startDay) return false;
  if (ev.recurUntil && focusDate > toLocalDateInput(ev.recurUntil)) return false;
  const focus = new Date(`${focusDate}T12:00:00`);
  const start = new Date(ev.startsAt);
  const freq = ev.recur || "ONCE";
  if (freq === "DAILY") return true;
  if (freq === "WEEKDAYS") {
    const d = focus.getDay();
    return d >= 1 && d <= 5;
  }
  if (freq === "WEEKLY") return focus.getDay() === start.getDay();
  if (freq === "MONTHLY") return focus.getDate() === start.getDate();
  if (freq === "CUSTOM") {
    const days = parseRecurDays(ev.recurDays);
    return days.includes(focus.getDay());
  }
  return false;
}

export function SchedulePanel({
  source,
  sourceId,
  defaultTitle,
  focusDate,
  onChanged,
  compact = false,
}: Props) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<CalEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("10:00");
  const [recur, setRecur] = useState<RecurFrequency>("ONCE");
  const [recurDays, setRecurDays] = useState<number[]>([]);
  const [recurUntil, setRecurUntil] = useState("");
  const [busy, setBusy] = useState(false);

  const schedulePath = source === "hunting" ? "hunting/interviews" : source;
  const startsAt = joinLocal(startDate, startTime);
  const endsAt = joinLocal(endDate, endTime);

  const load = useCallback(async () => {
    const data = await api<CalEvent[]>(`/${schedulePath}/${sourceId}/schedules`);
    setItems(data);
  }, [schedulePath, sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!focusDate) return items;
    return items.filter((ev) => occursOnFocus(ev, focusDate));
  }, [items, focusDate]);

  function beginAdd() {
    const start = focusDate ? new Date(`${focusDate}T09:00:00`) : new Date();
    if (!focusDate) {
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const startLocal = toLocalInput(start.toISOString());
    const endLocal = toLocalInput(end.toISOString());
    const s = splitLocal(startLocal);
    const e = splitLocal(endLocal);
    setTitle(defaultTitle ?? "");
    setStartDate(s.date);
    setStartTime(snapTime(s.time));
    setEndDate(e.date);
    setEndTime(snapTime(e.time));
    setRecur("ONCE");
    setRecurDays([start.getDay()]);
    setRecurUntil("");
    setOpen(true);
  }

  function durationMs() {
    const startIso = fromLocalInput(startsAt);
    const endIso = fromLocalInput(endsAt);
    if (!startIso || !endIso) return 60 * 60 * 1000;
    return Math.max(15 * 60 * 1000, new Date(endIso).getTime() - new Date(startIso).getTime());
  }

  function applyStart(nextDate: string, nextTime: string) {
    const prevStart = fromLocalInput(startsAt);
    const dur = durationMs();
    setStartDate(nextDate);
    setStartTime(nextTime);
    const joined = joinLocal(nextDate, nextTime);
    const nextStartIso = fromLocalInput(joined);
    if (!nextStartIso) return;
    // Keep duration when moving start; if start was unset, default 1h
    const useDur = prevStart ? dur : 60 * 60 * 1000;
    const nextEnd = new Date(new Date(nextStartIso).getTime() + useDur);
    const endLocal = splitLocal(toLocalInput(nextEnd.toISOString()));
    setEndDate(endLocal.date);
    setEndTime(snapTime(endLocal.time));
  }

  function onRecurChange(next: RecurFrequency) {
    setRecur(next);
    if (next === "CUSTOM" && recurDays.length === 0) {
      const startIso = fromLocalInput(startsAt);
      const dow = startIso ? new Date(startIso).getDay() : new Date().getDay();
      setRecurDays([dow]);
    }
  }

  function toggleDay(day: number) {
    setRecurDays((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length === 0 ? prev : next.sort((a, b) => a - b);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const startIso = fromLocalInput(startsAt);
    const endIso = fromLocalInput(endsAt);
    if (!startIso || !endIso) return;
    if (recur === "CUSTOM" && recurDays.length === 0) return;
    setBusy(true);
    try {
      await api(`/${schedulePath}/${sourceId}/schedules`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || defaultTitle,
          startsAt: startIso,
          endsAt: endIso,
          allDay: false,
          remindMinutes: 30,
          alertEnabled: true,
          recur,
          recurDays: recur === "CUSTOM" ? recurDays : [],
          recurUntil:
            recur !== "ONCE" && recurUntil
              ? new Date(`${recurUntil}T23:59:59`).toISOString()
              : null,
        }),
      });
      setOpen(false);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const seriesId = id.includes(":") ? id.split(":")[0]! : id;
    await api(`/calendar/${seriesId}`, { method: "DELETE" });
    await load();
    onChanged?.();
  }

  function recurSummary(ev: CalEvent) {
    if (!ev.recur || ev.recur === "ONCE") return "";
    if (ev.recur === "CUSTOM") {
      const days = parseRecurDays(ev.recurDays);
      if (days.length === 0) return ` · ${t("schedule.recur.CUSTOM")}`;
      return ` · ${formatCustomDays(days, i18n.language)}`;
    }
    return ` · ${t(`schedule.recur.${ev.recur as RecurFrequency}`)}`;
  }

  const canSave =
    Boolean(startDate && startTime && endDate && endTime) &&
    !(recur === "CUSTOM" && recurDays.length === 0);

  return (
    <div className={`schedule-panel${compact ? " compact" : ""}`}>
      <div className="schedule-panel-head">
        {!compact && <strong>{t("schedule.heading")}</strong>}
        <button type="button" className="btn" onClick={beginAdd}>
          {t("schedule.add")}
        </button>
      </div>

      {open && (
        <form className="schedule-form" onSubmit={(e) => void onAdd(e)} noValidate>
          <label className="schedule-field schedule-field-title" htmlFor="schedule-title">
            <span>{t("common.title")}</span>
            <input
              id="schedule-title"
              name="title"
              autoComplete="off"
              spellCheck={false}
              placeholder={`${t("common.title")}…`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <fieldset className="schedule-fieldset">
            <legend>{t("schedule.when")}</legend>
            <div className="schedule-when-grid">
              <div className="schedule-when-row">
                <span className="schedule-when-label">{t("schedule.start")}</span>
                <label className="schedule-field" htmlFor="schedule-start-date">
                  <span className="sr-only">{t("schedule.startDate")}</span>
                  <input
                    id="schedule-start-date"
                    type="date"
                    name="startDate"
                    autoComplete="off"
                    value={startDate}
                    onChange={(e) => applyStart(e.target.value, startTime)}
                    required
                  />
                </label>
                <label className="schedule-field" htmlFor="schedule-start-time">
                  <span className="sr-only">{t("schedule.startTime")}</span>
                  <select
                    id="schedule-start-time"
                    name="startTime"
                    autoComplete="off"
                    value={startTime}
                    onChange={(e) => applyStart(startDate, e.target.value)}
                    required
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {formatTimeOption(opt, i18n.language)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="schedule-when-row">
                <span className="schedule-when-label">{t("schedule.end")}</span>
                <label className="schedule-field" htmlFor="schedule-end-date">
                  <span className="sr-only">{t("schedule.endDate")}</span>
                  <input
                    id="schedule-end-date"
                    type="date"
                    name="endDate"
                    autoComplete="off"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </label>
                <label className="schedule-field" htmlFor="schedule-end-time">
                  <span className="sr-only">{t("schedule.endTime")}</span>
                  <select
                    id="schedule-end-time"
                    name="endTime"
                    autoComplete="off"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {formatTimeOption(opt, i18n.language)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </fieldset>

          <fieldset className="schedule-fieldset">
            <legend>{t("schedule.repeat")}</legend>
            <label className="schedule-field" htmlFor="schedule-recur">
              <span className="sr-only">{t("schedule.repeat")}</span>
              <select
                id="schedule-recur"
                name="recur"
                autoComplete="off"
                value={recur}
                onChange={(e) => onRecurChange(e.target.value as RecurFrequency)}
              >
                {RECUR_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {t(`schedule.recur.${opt}`)}
                  </option>
                ))}
              </select>
            </label>

            {recur === "CUSTOM" && (
              <div className="recur-days" role="group" aria-label={t("schedule.days")}>
                <p className="recur-days-hint muted small">{t("schedule.daysHint")}</p>
                <div className="recur-days-row">
                  {WEEKDAY_ORDER.map((day) => {
                    const pressed = recurDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`recur-day${pressed ? " is-on" : ""}`}
                        aria-pressed={pressed}
                        onClick={() => toggleDay(day)}
                      >
                        {weekdayLabel(day, i18n.language)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {recur !== "ONCE" && (
              <label className="schedule-field schedule-until" htmlFor="schedule-until">
                <span>{t("schedule.until")}</span>
                <input
                  id="schedule-until"
                  type="date"
                  name="recurUntil"
                  autoComplete="off"
                  value={recurUntil}
                  min={startDate || undefined}
                  onChange={(e) => setRecurUntil(e.target.value)}
                />
              </label>
            )}
          </fieldset>

          <div className="schedule-form-actions">
            <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button className="btn primary" disabled={busy || !canSave} aria-busy={busy}>
              {busy ? t("common.saving") : t("schedule.save")}
            </button>
          </div>
        </form>
      )}

      <div className="schedule-list">
        {visible.length === 0 && <p className="muted small">{t("schedule.empty")}</p>}
        {visible.map((ev) => (
          <div key={ev.id} className={`schedule-item tag-${ev.tag?.toLowerCase() ?? "schedule"}`}>
            <div className="schedule-item-body">
              <strong>{ev.title}</strong>
              <p className="muted small">
                {formatRange(ev, i18n.language)}
                {ev.tag === "DEADLINE" ? ` · ${t("schedule.deadline")}` : ""}
                {recurSummary(ev)}
              </p>
            </div>
            <button
              type="button"
              className="btn ghost"
              aria-label={t("common.delete")}
              onClick={() => void remove(ev.id)}
            >
              {t("common.delete")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
