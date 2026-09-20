import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiList } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  HuntingProfileSwitcher,
  isAllProfilesId,
  type HuntingProfile,
} from "../components/HuntingProfileSwitcher";
import { Pagination } from "../components/Pagination";
import { PeriodToolbar, toDateKey, type PeriodType } from "../components/PeriodToolbar";
import { RowSelectCheckbox } from "../components/RowSelectCheckbox";
import { SelectionBar } from "../components/SelectionBar";
import { SchedulePanel } from "../components/SchedulePanel";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { useRowSelection } from "../hooks/useRowSelection";
import { fromLocalInput } from "../lib/datetime";

const INTERVIEW_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
const PAGE_SIZE = 10;

type Interview = {
  id: string;
  profileId: string;
  bidId: string | null;
  company: string;
  roleTitle: string;
  status: (typeof INTERVIEW_STATUSES)[number];
  notes: string;
  scheduledAt: string | null;
  scheduleEndsAt: string | null;
  scheduleCount?: number;
  source?: "ICS" | "HUNTING";
  sourceType?: "GOOGLE" | "OUTLOOK";
  htmlLink?: string | null;
  readOnly?: boolean;
};

export function HuntingInterviewsPage() {
  const { t, i18n } = useTranslation();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<HuntingProfile[]>([]);
  const [items, setItems] = useState<Interview[]>([]);
  const [countsByStatus, setCountsByStatus] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const [anchorKey, setAnchorKey] = useState(() => toDateKey(new Date()));
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [createProfileId, setCreateProfileId] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const allProfilesMode = isAllProfilesId(profileId);
  const selectedProfile =
    profileId && !allProfilesMode ? profiles.find((p) => p.id === profileId) : undefined;
  const linkedFeedId = selectedProfile?.icsFeed?.id ?? null;
  const canCreate = profiles.some((p) => p.active) || profiles.length > 0;

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setPage(1);
    setExpanded(null);
    setCreating(false);
  }, [profileId, statusFilter, debouncedQuery, period, anchorKey]);

  useEffect(() => {
    if (!creating) return;
    if (profileId && !isAllProfilesId(profileId)) {
      setCreateProfileId(profileId);
    } else if (!createProfileId) {
      const fallback = profiles.find((p) => p.active)?.id ?? profiles[0]?.id ?? "";
      setCreateProfileId(fallback);
    }
  }, [creating, profileId, profiles, createProfileId]);

  const load = useCallback(async () => {
    if (!profileId) {
      setItems([]);
      setCountsByStatus({});
      setTotal(0);
      setTotalPages(1);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        period,
        includeImported: "true",
      });
      params.set("date", anchorKey);
      if (!isAllProfilesId(profileId)) {
        params.set("profileId", profileId);
      }
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);
      const { data, meta } = await apiList<Interview[]>(`/hunting/interviews?${params}`);
      setItems(data);
      setTotal(meta.total);
      setTotalPages(meta.totalPages);
      setCountsByStatus(meta.countsByStatus ?? {});
      if (page > meta.totalPages && meta.totalPages > 0) setPage(meta.totalPages);
    } finally {
      setLoading(false);
    }
  }, [profileId, page, statusFilter, debouncedQuery, period, anchorKey, reloadToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const pipelineTotal = useMemo(
    () => INTERVIEW_STATUSES.reduce((sum, s) => sum + (countsByStatus[s] ?? 0), 0),
    [countsByStatus],
  );

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!createProfileId) return;
    setSaving(true);
    try {
      await api("/hunting/interviews", {
        method: "POST",
        body: JSON.stringify({
          profileId: createProfileId,
          company,
          roleTitle,
          status: "SCHEDULED",
          notes,
          scheduledAt: fromLocalInput(scheduledAt),
          scheduleEndsAt: scheduledAt
            ? new Date(new Date(scheduledAt).getTime() + 60 * 60 * 1000).toISOString()
            : null,
        }),
      });
      setCompany("");
      setRoleTitle("");
      setNotes("");
      setScheduledAt("");
      setCreating(false);
      setStatusFilter("ALL");
      setPage(1);
      setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    await api(`/hunting/interviews/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setReloadToken((n) => n + 1);
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await api(`/hunting/interviews/${id}`, { method: "DELETE" });
      if (expanded === id) setExpanded(null);
      setDeleteId(null);
      selection.clear();
      if (items.length === 1 && page > 1) setPage((p) => p - 1);
      else setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(ids.map((id) => api(`/hunting/interviews/${id}`, { method: "DELETE" })));
      if (expanded && ids.includes(expanded)) setExpanded(null);
      setConfirmBulkDelete(false);
      selection.clear();
      const remaining = items.length - ids.length;
      if (remaining <= 0 && page > 1) setPage((p) => p - 1);
      else setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  const selectableIds = useMemo(
    () => items.filter((h) => !(h.readOnly || h.source === "ICS")).map((h) => h.id),
    [items],
  );
  const selection = useRowSelection(selectableIds);

  async function syncLinkedCalendar() {
    if (!linkedFeedId) return;
    setSyncing(true);
    try {
      // Omit from/to so the API uses the default −1 / +3 month ICS window.
      await api(`/integrations/calendar/ics/${linkedFeedId}/sync`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setReloadToken((n) => n + 1);
    } finally {
      setSyncing(false);
    }
  }

  function formatWhen(iso: string | null) {
    if (!iso) return t("hunting.noSchedule");
    return new Date(iso).toLocaleString(i18n.language, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatRange(start: string | null, end: string | null) {
    if (!start) return t("hunting.noSchedule");
    const startLabel = formatWhen(start);
    if (!end) return startLabel;
    const endLabel = new Date(end).toLocaleString(i18n.language, {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${startLabel} – ${endLabel}`;
  }

  return (
    <section className="page hunting-page">
      <div className="page-header hunting-page-header">
        <div>
          <h1>{t("hunting.interviews.heading")}</h1>
        </div>
        <div className="itsm-header-actions">
          {linkedFeedId && (
            <button
              type="button"
              className="btn"
              disabled={syncing || loading}
              onClick={() => void syncLinkedCalendar()}
            >
              {syncing ? t("common.saving") : t("hunting.interviews.syncImported")}
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              className="btn primary"
              onClick={() => setCreating((v) => !v)}
            >
              {creating ? t("common.cancel") : t("hunting.interviews.new")}
            </button>
          )}
        </div>
      </div>

      <HuntingProfileSwitcher
        profileId={profileId}
        onProfileIdChange={setProfileId}
        onProfilesLoaded={setProfiles}
      />

      {!profileId ? (
        <div className="empty-state hunting-empty">
          <p>{t("hunting.profile.needProfileOrImport")}</p>
        </div>
      ) : (
        <>
          <PeriodToolbar
            period={period}
            anchorKey={anchorKey}
            onPeriodChange={setPeriod}
            onAnchorKeyChange={setAnchorKey}
            labelKey="hunting.periodLabel"
          />

          <div className="hunting-kpi" role="group" aria-label={t("hunting.interviews.pipeline")}>
            <button
              type="button"
              className={`hunting-kpi-card${statusFilter === "ALL" ? " active" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              <span className="hunting-kpi-label">{t("hunting.interviews.filterAll")}</span>
              <strong className="tabular">{pipelineTotal}</strong>
            </button>
            {INTERVIEW_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`hunting-kpi-card${statusFilter === s ? " active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                <span className="hunting-kpi-label">{t(`hunting.interviews.status.${s}`)}</span>
                <strong className="tabular">{countsByStatus[s] ?? 0}</strong>
              </button>
            ))}
          </div>

          {creating && canCreate && (
            <form className="panel hunting-create" onSubmit={(e) => void onAdd(e)}>
              <header className="hunting-panel-head">
                <h2>{t("hunting.interviews.new")}</h2>
              </header>
              <div className="hunting-form-grid">
                <label className="field hunting-span-2">
                  <span>{t("hunting.profile.label")}</span>
                  <select
                    value={createProfileId}
                    onChange={(e) => setCreateProfileId(e.target.value)}
                    required
                  >
                    <option value="">{t("hunting.profile.empty")}</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id} translate="no">
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("common.company")}</span>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder={t("hunting.bids.companyPlaceholder")}
                    required
                    autoComplete="organization"
                  />
                </label>
                <label className="field">
                  <span>{t("common.role")}</span>
                  <input
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    placeholder={t("hunting.bids.rolePlaceholder")}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("hunting.schedule")}</span>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    title={t("hunting.firstSlot")}
                  />
                </label>
                <label className="field">
                  <span>{t("common.notes")}</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("hunting.interviews.notesPlaceholder")}
                  />
                </label>
              </div>
              <div className="row-actions">
                <button
                  className="btn primary"
                  type="submit"
                  disabled={saving || !createProfileId}
                >
                  {saving ? t("common.saving") : t("hunting.interviews.create")}
                </button>
                <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}

          <div className="hunting-toolbar panel">
            <label className="field hunting-search">
              <span className="sr-only">{t("hunting.interviews.search")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("hunting.interviews.searchPlaceholder")}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span className="sr-only">{t("common.status")}</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t("hunting.interviews.filterStatus")}
              >
                <option value="ALL">{t("hunting.interviews.filterAll")}</option>
                {INTERVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`hunting.interviews.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small tabular hunting-result-count">
              {t("hunting.interviews.resultCount", { count: total })}
            </p>
          </div>

          <div className="hunting-list">
            {loading && <p className="muted small hunting-pad">{t("common.loading")}</p>}
            {!loading && items.length === 0 && (
              <div className="empty-state hunting-empty">
                <p>{t("hunting.interviews.empty")}</p>
              </div>
            )}
            {!loading && selectableIds.length > 0 ? (
              <SelectionBar
                selection={selection}
                pageIds={selectableIds}
                disabled={loading}
                deleteBusy={saving}
                onDeleteSelected={() => setConfirmBulkDelete(true)}
              />
            ) : null}
            {!loading &&
              items.map((h) => {
                const readOnly = Boolean(h.readOnly || h.source === "ICS");
                return (
                  <article
                    key={h.id}
                    className={`panel hunting-card${
                      selection.isSelected(h.id) ? " is-selected" : ""
                    }`}
                  >
                    <div className="hunting-card-main">
                      {!readOnly ? (
                        <RowSelectCheckbox
                          checked={selection.isSelected(h.id)}
                          onChange={() => selection.toggle(h.id)}
                          label={t("common.selectRow")}
                          disabled={saving || loading}
                        />
                      ) : (
                        <span className="row-select row-select-spacer" aria-hidden />
                      )}
                      <div className="hunting-card-copy">
                        <div className="hunting-card-title-row">
                          <h3 translate="no">
                            {h.company}
                            {h.roleTitle && h.source !== "ICS" ? (
                              <>
                                <span className="hunting-card-sep">—</span>
                                {h.roleTitle}
                              </>
                            ) : null}
                          </h3>
                          <StatusBadge tone={statusTone(h.status)}>
                            {t(`hunting.interviews.status.${h.status}`)}
                          </StatusBadge>
                        </div>
                        {!readOnly && h.notes ? (
                          <p className="muted hunting-card-notes">{h.notes}</p>
                        ) : null}
                        <div className="hunting-card-meta">
                          <span className="hunting-meta-chip tabular">
                            {formatRange(h.scheduledAt, h.scheduleEndsAt)}
                          </span>
                          {(h.scheduleCount ?? 0) > 1 && (
                            <span className="hunting-meta-chip tabular">
                              {t("hunting.interviews.scheduleCount", { count: h.scheduleCount })}
                            </span>
                          )}
                          {h.source === "ICS" && h.roleTitle ? (
                            <span className="hunting-meta-chip">{h.roleTitle}</span>
                          ) : null}
                          {h.source === "ICS" && h.sourceType && (
                            <span className="hunting-meta-chip">
                              {t(`hunting.interviews.source.${h.sourceType}`)}
                            </span>
                          )}
                          {allProfilesMode && (
                            <span className="hunting-meta-chip" translate="no">
                              {profiles.find((p) => p.id === h.profileId)?.name ?? "—"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="hunting-card-actions">
                        {!readOnly && (
                          <>
                            <label className="field hunting-status-field">
                              <span className="sr-only">{t("common.status")}</span>
                              <select
                                value={h.status}
                                onChange={(e) => void updateStatus(h.id, e.target.value)}
                                aria-label={t("common.status")}
                              >
                                {INTERVIEW_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {t(`hunting.interviews.status.${s}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => setExpanded(expanded === h.id ? null : h.id)}
                            >
                              {t("schedule.manage")}
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => setDeleteId(h.id)}
                            >
                              {t("common.delete")}
                            </button>
                          </>
                        )}
                        {readOnly && h.htmlLink && (
                          <a
                            className="btn"
                            href={h.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("hunting.interviews.openCalendar")}
                          </a>
                        )}
                      </div>
                    </div>
                    {!readOnly && expanded === h.id && (
                      <div className="hunting-card-schedule">
                        <SchedulePanel source="hunting" sourceId={h.id} />
                      </div>
                    )}
                  </article>
                );
              })}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            disabled={loading}
          />
        </>
      )}

      <ConfirmDialog
        open={deleteId != null}
        title={t("hunting.interviews.deleteTitle")}
        body={t("hunting.interviews.confirmDelete")}
        danger
        busy={saving}
        onConfirm={() => {
          if (deleteId) void remove(deleteId);
        }}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={t("common.deleteSelectedTitle")}
        body={t("common.confirmDeleteSelected", { count: selection.selectedCount })}
        danger
        busy={saving}
        onConfirm={() => void removeSelected()}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </section>
  );
}

