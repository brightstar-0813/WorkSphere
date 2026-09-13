import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { RowSelectCheckbox } from "./RowSelectCheckbox";
import { SelectionBar } from "./SelectionBar";
import { SchedulePanel } from "./SchedulePanel";
import { statusTone } from "./StatusBadge";
import { useRowSelection } from "../hooks/useRowSelection";
import { addDays, toLocalDateInput } from "../lib/datetime";
import type { CalEvent } from "../types/calendar";

export type ItemStatus =
  | "TODO"
  | "IN_PROGRESS"
  | "DONE"
  | "FAILED"
  | "BACKLOG"
  | "OVERDUE";

type Filter = "ALL" | ItemStatus;

type DayItem = {
  id: string;
  title: string;
  description: string;
  status: ItemStatus;
};

type DailyBoard = {
  jobId: string;
  date: string;
  logId: string;
  items: DayItem[];
  schedules: CalEvent[];
};

type Props = {
  jobId: string;
  jobTitle: string;
};

const STATUSES: ItemStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "DONE",
  "FAILED",
  "BACKLOG",
  "OVERDUE",
];

function todayInput() {
  return toLocalDateInput(new Date().toISOString());
}

function statusLabelKey(status: ItemStatus) {
  return `jobs.daily.itemStatus.${status}`;
}

export function JobDailyPanel({ jobId, jobTitle }: Props) {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get("date");
  const [date, setDate] = useState(
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInput
  );
  const [board, setBoard] = useState<DailyBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [descDrafts, setDescDrafts] = useState<Record<string, string>>({});
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const setDay = useCallback(
    (next: string) => {
      setDate(next);
      const params = new URLSearchParams(searchParams);
      params.set("date", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<DailyBoard>(`/jobs/${jobId}/daily?date=${encodeURIComponent(date)}`);
      setBoard(data);
      const titles: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const item of data.items) {
        titles[item.id] = item.title;
        descs[item.id] = item.description;
      }
      setTitleDrafts(titles);
      setDescDrafts(descs);
    } finally {
      setLoading(false);
    }
  }, [jobId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const title = draftTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      await api(`/jobs/${jobId}/daily/items`, {
        method: "POST",
        body: JSON.stringify({
          date,
          title,
          description: draftDesc.trim(),
        }),
      });
      setDraftTitle("");
      setDraftDesc("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(itemId: string, status: ItemStatus) {
    await api(`/jobs/${jobId}/daily/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await load();
  }

  async function commitTitle(item: DayItem) {
    const title = (titleDrafts[item.id] ?? item.title).trim();
    if (!title) {
      setTitleDrafts((d) => ({ ...d, [item.id]: item.title }));
      return;
    }
    if (title === item.title) return;
    await api(`/jobs/${jobId}/daily/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    await load();
  }

  async function commitDescription(item: DayItem) {
    const description = (descDrafts[item.id] ?? item.description).trim();
    if (description === item.description) {
      setDescDrafts((d) => ({ ...d, [item.id]: item.description }));
      return;
    }
    await api(`/jobs/${jobId}/daily/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description }),
    });
    await load();
  }

  const items = board?.items ?? [];
  const visible = useMemo(
    () => (filter === "ALL" ? items : items.filter((i) => i.status === filter)),
    [items, filter],
  );
  const pageIds = useMemo(() => visible.map((i) => i.id), [visible]);
  const selection = useRowSelection(pageIds);

  async function removeItem(itemId: string) {
    await api(`/jobs/${jobId}/daily/items/${itemId}`, { method: "DELETE" });
    selection.clear();
    await load();
  }

  async function removeSelected() {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        ids.map((id) => api(`/jobs/${jobId}/daily/items/${id}`, { method: "DELETE" })),
      );
      setConfirmBulkDelete(false);
      selection.clear();
      await load();
    } finally {
      setBusy(false);
    }
  }

  function shiftDay(dir: -1 | 1) {
    const next = addDays(new Date(`${date}T12:00:00`), dir);
    setDay(toLocalDateInput(next.toISOString()));
  }

  const metrics = useMemo(() => {
    const todo = items.filter((i) => i.status === "TODO").length;
    const progress = items.filter((i) => i.status === "IN_PROGRESS").length;
    const attention = items.filter(
      (i) => i.status === "FAILED" || i.status === "OVERDUE"
    ).length;
    const schedules = board?.schedules.length ?? 0;
    return { todo, progress, attention, schedules };
  }, [items, board?.schedules.length]);

  const dayLabel = new Date(`${date}T12:00:00`).toLocaleDateString(i18n.language, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const filterOptions: Filter[] = ["ALL", ...STATUSES];

  return (
    <div className="job-daily itsm-daily">
      <div className="itsm-ops-bar">
        <div>
          <strong className="itsm-day-label">{dayLabel}</strong>
        </div>
        <div className="job-daily-toolbar">
          <div className="cal-nav" role="group" aria-label={t("jobs.daily.day")}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => shiftDay(-1)}
              aria-label={t("calendar.prev")}
            >
              ‹
            </button>
            <button type="button" className="btn" onClick={() => setDay(todayInput())}>
              {t("calendar.today")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => shiftDay(1)}
              aria-label={t("calendar.next")}
            >
              ›
            </button>
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDay(e.target.value)}
            aria-label={t("jobs.daily.day")}
          />
        </div>
      </div>

      <div className="itsm-metrics" aria-live="polite">
        <div className="itsm-metric">
          <span className="itsm-metric-label">{t("jobs.daily.metricTodos")}</span>
          <strong className="tabular">{metrics.todo}</strong>
        </div>
        <div className="itsm-metric info">
          <span className="itsm-metric-label">{t("jobs.daily.metricProgress")}</span>
          <strong className="tabular">{metrics.progress}</strong>
        </div>
        <div className="itsm-metric warn">
          <span className="itsm-metric-label">{t("jobs.daily.metricAttention")}</span>
          <strong className="tabular">{metrics.attention}</strong>
        </div>
        <div className="itsm-metric accent">
          <span className="itsm-metric-label">{t("jobs.daily.metricSchedules")}</span>
          <strong className="tabular">{metrics.schedules}</strong>
        </div>
      </div>

      <div className="itsm-daily-grid">
        <section className="itsm-queue" aria-labelledby="work-queue-heading">
          <header className="itsm-section-head">
            <div>
              <h3 id="work-queue-heading">{t("jobs.daily.workQueue")}</h3>
            </div>
            <div className="itsm-filter-pills" role="tablist" aria-label={t("jobs.daily.filter")}>
              {filterOptions.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  className={`itsm-pill${filter === f ? " active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "ALL" ? t("jobs.filterAll") : t(statusLabelKey(f))}
                </button>
              ))}
            </div>
          </header>

          <form className="daily-add unified itsm-composer" onSubmit={(e) => void addItem(e)}>
            <div
              className="field-group"
              role="group"
              aria-label={t("jobs.daily.composer")}
            >
              <input
                name="workItem"
                autoComplete="off"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={t("jobs.daily.addWork")}
                aria-label={t("jobs.daily.itemTitle")}
                maxLength={200}
              />
              <input
                name="description"
                autoComplete="off"
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder={`${t("jobs.daily.itemDescription")}…`}
                aria-label={t("jobs.daily.itemDescription")}
                maxLength={2000}
              />
            </div>
            <button className="btn primary" disabled={busy || !draftTitle.trim()}>
              {busy ? t("common.saving") : t("jobs.daily.addTodo")}
            </button>
          </form>

          {loading && <p className="muted small">{t("common.loading")}</p>}

          {!loading && visible.length > 0 ? (
            <SelectionBar
              selection={selection}
              pageIds={pageIds}
              disabled={busy || loading}
              deleteBusy={busy}
              onDeleteSelected={() => setConfirmBulkDelete(true)}
            />
          ) : null}

          <ul className="daily-list unified itsm-queue-list">
            {!loading && visible.length === 0 && (
              <li className="itsm-queue-empty muted">{t("jobs.daily.empty")}</li>
            )}
            {visible.map((item) => (
              <li
                key={item.id}
                className={`daily-item itsm-queue-item status-${item.status.toLowerCase()}${
                  selection.isSelected(item.id) ? " is-selected" : ""
                }`}
              >
                <RowSelectCheckbox
                  checked={selection.isSelected(item.id)}
                  onChange={() => selection.toggle(item.id)}
                  label={t("common.selectRow")}
                  disabled={busy || loading}
                />
                <label className="field itsm-status-field">
                  <span className="sr-only">{t("common.status")}</span>
                  <select
                    className={`itsm-status-select tone-${statusTone(item.status)}`}
                    value={item.status}
                    onChange={(e) => void updateStatus(item.id, e.target.value as ItemStatus)}
                    aria-label={t("jobs.daily.changeStatus")}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(statusLabelKey(s))}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field itsm-title-field">
                  <span className="sr-only">{t("jobs.daily.itemTitle")}</span>
                  <input
                    className="itsm-inline-input itsm-title-input"
                    value={titleDrafts[item.id] ?? item.title}
                    onChange={(e) =>
                      setTitleDrafts((d) => ({ ...d, [item.id]: e.target.value }))
                    }
                    onBlur={() => void commitTitle(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    maxLength={200}
                    placeholder={t("jobs.daily.itemTitle")}
                  />
                </label>

                <label className="field itsm-desc-field">
                  <span className="sr-only">{t("jobs.daily.itemDescription")}</span>
                  <input
                    className="itsm-inline-input itsm-desc-input"
                    value={descDrafts[item.id] ?? item.description}
                    onChange={(e) =>
                      setDescDrafts((d) => ({ ...d, [item.id]: e.target.value }))
                    }
                    onBlur={() => void commitDescription(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    maxLength={2000}
                    placeholder={t("jobs.daily.itemDescription")}
                  />
                </label>

                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void removeItem(item.id)}
                  aria-label={t("common.delete")}
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="itsm-schedule-pane" aria-labelledby="schedule-heading">
          <header className="itsm-section-head">
            <div>
              <h3 id="schedule-heading">{t("jobs.daily.schedule")}</h3>
            </div>
            <span className="muted small tabular">{board?.schedules.length ?? 0}</span>
          </header>
          <SchedulePanel
            source="jobs"
            sourceId={jobId}
            focusDate={date}
            compact
            onChanged={() => void load()}
          />
        </section>
      </div>

      <ConfirmDialog
        open={confirmBulkDelete}
        title={t("common.deleteSelectedTitle")}
        body={t("common.confirmDeleteSelected", { count: selection.selectedCount })}
        danger
        busy={busy}
        onConfirm={() => void removeSelected()}
        onCancel={() => {
          if (!busy) setConfirmBulkDelete(false);
        }}
      />
    </div>
  );
}
