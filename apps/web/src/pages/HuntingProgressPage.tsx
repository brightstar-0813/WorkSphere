import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiList } from "../api";
import { useAuth } from "../auth";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  HuntingProfileSwitcher,
  isAllProfilesId,
  isSpecialProfileId,
} from "../components/HuntingProfileSwitcher";
import { Pagination } from "../components/Pagination";
import { RowSelectCheckbox } from "../components/RowSelectCheckbox";
import { SelectionBar } from "../components/SelectionBar";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { useRowSelection } from "../hooks/useRowSelection";
import { fromLocalInput, toLocalInput } from "../lib/datetime";
import { resolveAppTimeZone, toZonedInput, fromZonedInput } from "../lib/timezone";

const PAGE_SIZE = 10;

type ViewMode = "list" | "flow";

type ProgressOption = {
  id: string;
  kind: "STEP" | "STATUS";
  label: string;
  sortOrder: number;
};

type ProgressRow = {
  id: string;
  profileId: string | null;
  jobTitle: string;
  company: string;
  jobSiteSource: string;
  salary: string;
  step: string;
  status: string;
  scheduledAt: string | null;
  notes: string;
  profile?: { id: string; name: string } | null;
};

type Draft = {
  jobTitle: string;
  company: string;
  jobSiteSource: string;
  salary: string;
  step: string;
  status: string;
  scheduledAt: string;
  notes: string;
};

function emptyDraft(steps: ProgressOption[], statuses: ProgressOption[]): Draft {
  return {
    jobTitle: "",
    company: "",
    jobSiteSource: "",
    salary: "",
    step: steps[0]?.label ?? "",
    status: statuses[0]?.label ?? "",
    scheduledAt: "",
    notes: "",
  };
}

export function HuntingProgressPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const timeZone = resolveAppTimeZone(user?.timeZone);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<ProgressRow[]>([]);
  const [steps, setSteps] = useState<ProgressOption[]>([]);
  const [statuses, setStatuses] = useState<ProgressOption[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [stepFilter, setStepFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft([], []));
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionKind, setOptionKind] = useState<"STEP" | "STATUS">("STEP");
  const [optionDraft, setOptionDraft] = useState("");
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editingOptionLabel, setEditingOptionLabel] = useState("");
  const [deleteOptionId, setDeleteOptionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const allProfiles = isAllProfilesId(profileId);
  const canAttachProfile = profileId && !isSpecialProfileId(profileId);
  const pageIds = useMemo(() => items.map((row) => row.id), [items]);
  const selection = useRowSelection(pageIds);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setPage(1);
    setCreating(false);
    setEditingId(null);
  }, [profileId, stepFilter, statusFilter, debouncedQuery]);

  const loadOptions = useCallback(async () => {
    const data = await api<{ steps: ProgressOption[]; statuses: ProgressOption[] }>(
      "/hunting/progress/options",
    );
    setSteps(data.steps);
    setStatuses(data.statuses);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!profileId) {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (!isAllProfilesId(profileId) && !isSpecialProfileId(profileId)) {
        params.set("profileId", profileId);
      }
      if (stepFilter !== "ALL") params.set("step", stepFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);
      const { data, meta } = await apiList<ProgressRow[]>(`/hunting/progress?${params}`);
      setItems(data);
      setTotal(meta.total);
      setTotalPages(meta.totalPages);
      if (page > meta.totalPages && meta.totalPages > 0) setPage(meta.totalPages);
    } finally {
      setLoading(false);
    }
  }, [profileId, page, stepFilter, statusFilter, debouncedQuery, reloadToken]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
  }, [load]);

  function beginCreate() {
    setEditingId(null);
    setDraft(emptyDraft(steps, statuses));
    setCreating(true);
  }

  function beginEdit(row: ProgressRow) {
    setCreating(false);
    setEditingId(row.id);
    setDraft({
      jobTitle: row.jobTitle,
      company: row.company,
      jobSiteSource: row.jobSiteSource,
      salary: row.salary,
      step: row.step,
      status: row.status,
      scheduledAt: row.scheduledAt
        ? toZonedInput(row.scheduledAt, timeZone) || toLocalInput(row.scheduledAt)
        : "",
      notes: row.notes,
    });
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!profileId) return;
    setSaving(true);
    try {
      const scheduledAt =
        fromZonedInput(draft.scheduledAt, timeZone) || fromLocalInput(draft.scheduledAt);
      const body = {
        profileId: canAttachProfile ? profileId : null,
        jobTitle: draft.jobTitle.trim(),
        company: draft.company.trim(),
        jobSiteSource: draft.jobSiteSource.trim(),
        salary: draft.salary.trim(),
        step: draft.step,
        status: draft.status,
        scheduledAt,
        notes: draft.notes.trim(),
      };
      if (editingId) {
        await api(`/hunting/progress/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api("/hunting/progress", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setCreating(false);
      setEditingId(null);
      setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await api(`/hunting/progress/${id}`, { method: "DELETE" });
      setDeleteId(null);
      selection.clear();
      if (editingId === id) setEditingId(null);
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
      await Promise.all(ids.map((id) => api(`/hunting/progress/${id}`, { method: "DELETE" })));
      setConfirmBulkDelete(false);
      selection.clear();
      if (editingId && ids.includes(editingId)) setEditingId(null);
      const remaining = items.length - ids.length;
      if (remaining <= 0 && page > 1) setPage((p) => p - 1);
      else setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function quickPatch(id: string, patch: Partial<ProgressRow>) {
    await api(`/hunting/progress/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setReloadToken((n) => n + 1);
  }

  const optionList = optionKind === "STEP" ? steps : statuses;

  async function addOption(e: FormEvent) {
    e.preventDefault();
    if (!optionDraft.trim()) return;
    setSaving(true);
    try {
      await api("/hunting/progress/options", {
        method: "POST",
        body: JSON.stringify({ kind: optionKind, label: optionDraft.trim() }),
      });
      setOptionDraft("");
      await loadOptions();
    } finally {
      setSaving(false);
    }
  }

  async function saveOptionEdit(id: string) {
    if (!editingOptionLabel.trim()) return;
    setSaving(true);
    try {
      await api(`/hunting/progress/options/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ label: editingOptionLabel.trim() }),
      });
      setEditingOptionId(null);
      await loadOptions();
      setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function removeOption(id: string) {
    setSaving(true);
    try {
      await api(`/hunting/progress/options/${id}`, { method: "DELETE" });
      setDeleteOptionId(null);
      await loadOptions();
    } finally {
      setSaving(false);
    }
  }

  async function moveOption(id: string, direction: -1 | 1) {
    const index = optionList.findIndex((opt) => opt.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= optionList.length) return;

    const next = optionList.slice();
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    const ids = next.map((opt) => opt.id);

    if (optionKind === "STEP") {
      setSteps(next.map((opt, sortOrder) => ({ ...opt, sortOrder })));
    } else {
      setStatuses(next.map((opt, sortOrder) => ({ ...opt, sortOrder })));
    }

    setSaving(true);
    try {
      const data = await api<ProgressOption[]>("/hunting/progress/options/reorder", {
        method: "PUT",
        body: JSON.stringify({ kind: optionKind, ids }),
      });
      if (optionKind === "STEP") setSteps(data);
      else setStatuses(data);
    } catch {
      await loadOptions();
    } finally {
      setSaving(false);
    }
  }

  function formatWhen(iso: string | null) {
    if (!iso) return t("hunting.noSchedule");
    return new Date(iso).toLocaleString(i18n.language, {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function stepState(rowStep: string, stepLabel: string, index: number) {
    const currentIdx = steps.findIndex((s) => s.label === rowStep);
    if (currentIdx < 0) {
      return rowStep === stepLabel ? "current" : "upcoming";
    }
    if (index < currentIdx) return "done";
    if (index === currentIdx) return "current";
    return "upcoming";
  }

  const formOpen = creating || editingId != null;

  const filterSteps = useMemo(() => steps, [steps]);
  const filterStatuses = useMemo(() => statuses, [statuses]);

  return (
    <section className="page hunting-page">
      <div className="page-header hunting-page-header">
        <div>
          <h1>{t("hunting.progress.heading")}</h1>
        </div>
        {profileId && (
          <div className="itsm-header-actions">
            <button type="button" className="btn" onClick={() => setOptionsOpen((v) => !v)}>
              {optionsOpen ? t("common.cancel") : t("hunting.progress.manageOptions")}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => (formOpen && !editingId ? setCreating(false) : beginCreate())}
            >
              {creating && !editingId ? t("common.cancel") : t("hunting.progress.new")}
            </button>
          </div>
        )}
      </div>

      <HuntingProfileSwitcher profileId={profileId} onProfileIdChange={setProfileId} />

      {!profileId ? (
        <div className="empty-state hunting-empty">
          <p>{t("hunting.profile.needProfile")}</p>
        </div>
      ) : (
        <>
          {optionsOpen && (
            <div className="panel hunting-create">
              <header className="hunting-panel-head">
                <h2>{t("hunting.progress.manageOptions")}</h2>
              </header>
              <div className="hunting-toolbar" style={{ marginBottom: "0.75rem" }}>
                <div className="cal-views" role="group">
                  <button
                    type="button"
                    className={`btn${optionKind === "STEP" ? " primary" : " ghost"}`}
                    onClick={() => setOptionKind("STEP")}
                  >
                    {t("hunting.progress.step")}
                  </button>
                  <button
                    type="button"
                    className={`btn${optionKind === "STATUS" ? " primary" : " ghost"}`}
                    onClick={() => setOptionKind("STATUS")}
                  >
                    {t("common.status")}
                  </button>
                </div>
              </div>
              <form className="hunting-form-grid" onSubmit={(e) => void addOption(e)}>
                <label className="field hunting-span-2">
                  <span>{t("hunting.progress.newOption")}</span>
                  <input
                    value={optionDraft}
                    onChange={(e) => setOptionDraft(e.target.value)}
                    placeholder={t("hunting.progress.optionPlaceholder")}
                    required
                  />
                </label>
                <div className="row-actions hunting-span-2">
                  <button className="btn primary" type="submit" disabled={saving}>
                    {t("common.add")}
                  </button>
                </div>
              </form>
              <ul className="hunting-list hunting-option-list">
                {optionList.map((opt, index) => (
                  <li key={opt.id} className="panel hunting-card hunting-option-card">
                    <div className="hunting-card-main">
                      {editingOptionId === opt.id ? (
                        <div className="hunting-form-grid" style={{ flex: 1 }}>
                          <label className="field hunting-span-2">
                            <span className="sr-only">{t("common.edit")}</span>
                            <input
                              value={editingOptionLabel}
                              onChange={(e) => setEditingOptionLabel(e.target.value)}
                              autoFocus
                            />
                          </label>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn primary"
                              disabled={saving}
                              onClick={() => void saveOptionEdit(opt.id)}
                            >
                              {t("common.save")}
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => setEditingOptionId(null)}
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="hunting-option-label">
                            <span className="hunting-option-index tabular muted">{index + 1}</span>
                            <strong translate="no">{opt.label}</strong>
                          </div>
                          <div className="hunting-card-actions">
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={saving || index === 0}
                              aria-label={t("common.moveUp")}
                              title={t("common.moveUp")}
                              onClick={() => void moveOption(opt.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={saving || index === optionList.length - 1}
                              aria-label={t("common.moveDown")}
                              title={t("common.moveDown")}
                              onClick={() => void moveOption(opt.id, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => {
                                setEditingOptionId(opt.id);
                                setEditingOptionLabel(opt.label);
                              }}
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => setDeleteOptionId(opt.id)}
                            >
                              {t("common.delete")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {formOpen && (
            <form className="panel hunting-create" onSubmit={(e) => void saveDraft(e)}>
              <header className="hunting-panel-head">
                <h2>{editingId ? t("hunting.progress.edit") : t("hunting.progress.new")}</h2>
              </header>
              <div className="hunting-form-grid">
                <label className="field">
                  <span>{t("hunting.progress.jobTitle")}</span>
                  <input
                    value={draft.jobTitle}
                    onChange={(e) => setDraft((d) => ({ ...d, jobTitle: e.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("common.company")}</span>
                  <input
                    value={draft.company}
                    onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("hunting.progress.jobSiteSource")}</span>
                  <input
                    value={draft.jobSiteSource}
                    onChange={(e) => setDraft((d) => ({ ...d, jobSiteSource: e.target.value }))}
                    placeholder={t("hunting.progress.sourcePlaceholder")}
                  />
                </label>
                <label className="field">
                  <span>{t("hunting.progress.salary")}</span>
                  <input
                    value={draft.salary}
                    onChange={(e) => setDraft((d) => ({ ...d, salary: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>{t("hunting.progress.step")}</span>
                  <select
                    value={draft.step}
                    onChange={(e) => setDraft((d) => ({ ...d, step: e.target.value }))}
                  >
                    <option value="">{t("hunting.progress.noStep")}</option>
                    {steps.map((s) => (
                      <option key={s.id} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("common.status")}</span>
                  <select
                    value={draft.status}
                    onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                  >
                    <option value="">{t("hunting.progress.noStatus")}</option>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("hunting.progress.time")}</span>
                  <input
                    type="datetime-local"
                    value={draft.scheduledAt}
                    onChange={(e) => setDraft((d) => ({ ...d, scheduledAt: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>{t("common.notes")}</span>
                  <input
                    value={draft.notes}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder={t("hunting.progress.notesPlaceholder")}
                  />
                </label>
              </div>
              <div className="row-actions">
                <button className="btn primary" type="submit" disabled={saving}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setCreating(false);
                    setEditingId(null);
                  }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}

          <div className="hunting-toolbar panel">
            <div className="cal-views progress-view-toggle" role="group" aria-label={t("hunting.progress.viewMode")}>
              <button
                type="button"
                className={`btn${viewMode === "list" ? " primary" : " ghost"}`}
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                {t("hunting.progress.viewList")}
              </button>
              <button
                type="button"
                className={`btn${viewMode === "flow" ? " primary" : " ghost"}`}
                aria-pressed={viewMode === "flow"}
                onClick={() => setViewMode("flow")}
              >
                {t("hunting.progress.viewFlow")}
              </button>
            </div>
            <label className="field hunting-search">
              <span className="sr-only">{t("hunting.progress.search")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("hunting.progress.searchPlaceholder")}
              />
            </label>
            <label className="field">
              <span className="sr-only">{t("hunting.progress.step")}</span>
              <select value={stepFilter} onChange={(e) => setStepFilter(e.target.value)}>
                <option value="ALL">{t("hunting.progress.filterAllSteps")}</option>
                {filterSteps.map((s) => (
                  <option key={s.id} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="sr-only">{t("common.status")}</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="ALL">{t("hunting.progress.filterAllStatuses")}</option>
                {filterStatuses.map((s) => (
                  <option key={s.id} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small tabular hunting-result-count">
              {t("hunting.progress.resultCount", { count: total })}
            </p>
          </div>

          {viewMode === "flow" && steps.length === 0 && !loading && (
            <div className="empty-state hunting-empty">
              <p>{t("hunting.progress.flowEmptySteps")}</p>
            </div>
          )}

          <div className="hunting-list">
            {loading && <p className="muted small hunting-pad">{t("common.loading")}</p>}
            {!loading && items.length === 0 && (
              <div className="empty-state hunting-empty">
                <p>{t("hunting.progress.empty")}</p>
              </div>
            )}
            {!loading && items.length > 0 ? (
              <SelectionBar
                selection={selection}
                pageIds={pageIds}
                disabled={loading}
                deleteBusy={saving}
                onDeleteSelected={() => setConfirmBulkDelete(true)}
              />
            ) : null}
            {!loading &&
              viewMode === "list" &&
              items.map((row) => (
                <article
                  key={row.id}
                  className={`panel hunting-card${selection.isSelected(row.id) ? " is-selected" : ""}`}
                >
                  <div className="hunting-card-main">
                    <RowSelectCheckbox
                      checked={selection.isSelected(row.id)}
                      onChange={() => selection.toggle(row.id)}
                      label={t("common.selectRow")}
                      disabled={saving || loading}
                    />
                    <div className="hunting-card-copy">
                      <div className="hunting-card-title-row">
                        <h3 translate="no">
                          {row.company}
                          <span className="hunting-card-sep">—</span>
                          {row.jobTitle}
                        </h3>
                        {row.status ? (
                          <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                        ) : null}
                      </div>
                      {row.notes ? <p className="muted hunting-card-notes">{row.notes}</p> : null}
                      <div className="hunting-card-meta">
                        {row.step ? (
                          <span className="hunting-meta-chip">{row.step}</span>
                        ) : null}
                        <span className="hunting-meta-chip tabular">
                          {formatWhen(row.scheduledAt)}
                        </span>
                        {row.salary ? (
                          <span className="hunting-meta-chip">{row.salary}</span>
                        ) : null}
                        {row.jobSiteSource ? (
                          <span className="hunting-meta-chip">{row.jobSiteSource}</span>
                        ) : null}
                        {allProfiles && row.profile?.name ? (
                          <span className="hunting-meta-chip">{row.profile.name}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="hunting-card-actions">
                      <label className="field hunting-status-field">
                        <span className="sr-only">{t("hunting.progress.step")}</span>
                        <select
                          value={row.step}
                          onChange={(e) => void quickPatch(row.id, { step: e.target.value })}
                        >
                          <option value="">{t("hunting.progress.noStep")}</option>
                          {steps.map((s) => (
                            <option key={s.id} value={s.label}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field hunting-status-field">
                        <span className="sr-only">{t("common.status")}</span>
                        <select
                          value={row.status}
                          onChange={(e) => void quickPatch(row.id, { status: e.target.value })}
                        >
                          <option value="">{t("hunting.progress.noStatus")}</option>
                          {statuses.map((s) => (
                            <option key={s.id} value={s.label}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="btn" onClick={() => beginEdit(row)}>
                        {t("common.edit")}
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setDeleteId(row.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            {!loading &&
              viewMode === "flow" &&
              steps.length > 0 &&
              items.map((row) => {
                const knownStep = steps.some((s) => s.label === row.step);
                return (
                  <article
                    key={row.id}
                    className={`panel hunting-card progress-flow-card${
                      selection.isSelected(row.id) ? " is-selected" : ""
                    }`}
                  >
                    <div className="progress-flow-head">
                      <RowSelectCheckbox
                        checked={selection.isSelected(row.id)}
                        onChange={() => selection.toggle(row.id)}
                        label={t("common.selectRow")}
                        disabled={saving || loading}
                      />
                      <div className="hunting-card-copy">
                        <div className="hunting-card-title-row">
                          <h3 translate="no">
                            {row.company}
                            <span className="hunting-card-sep">—</span>
                            {row.jobTitle}
                          </h3>
                          {row.status ? (
                            <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                          ) : null}
                        </div>
                        {row.notes ? <p className="muted hunting-card-notes">{row.notes}</p> : null}
                        <div className="hunting-card-meta">
                          <span className="hunting-meta-chip tabular">
                            {formatWhen(row.scheduledAt)}
                          </span>
                          {row.salary ? (
                            <span className="hunting-meta-chip">{row.salary}</span>
                          ) : null}
                          {row.jobSiteSource ? (
                            <span className="hunting-meta-chip">{row.jobSiteSource}</span>
                          ) : null}
                          {allProfiles && row.profile?.name ? (
                            <span className="hunting-meta-chip">{row.profile.name}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="hunting-card-actions">
                        <label className="field hunting-status-field">
                          <span className="sr-only">{t("hunting.progress.step")}</span>
                          <select
                            value={row.step}
                            onChange={(e) => void quickPatch(row.id, { step: e.target.value })}
                            aria-label={t("hunting.progress.step")}
                          >
                            <option value="">{t("hunting.progress.noStep")}</option>
                            {steps.map((s) => (
                              <option key={s.id} value={s.label}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field hunting-status-field">
                          <span className="sr-only">{t("common.status")}</span>
                          <select
                            value={row.status}
                            onChange={(e) => void quickPatch(row.id, { status: e.target.value })}
                          >
                            <option value="">{t("hunting.progress.noStatus")}</option>
                            {statuses.map((s) => (
                              <option key={s.id} value={s.label}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="btn" onClick={() => beginEdit(row)}>
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => setDeleteId(row.id)}
                        >
                          {t("common.delete")}
                        </button>
                      </div>
                    </div>

                    <div
                      className="progress-flow-track"
                      role="group"
                      aria-label={t("hunting.progress.step")}
                    >
                      {steps.map((s, index) => {
                        const state = stepState(row.step, s.label, index);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`progress-flow-step is-${state}`}
                            aria-current={state === "current" ? "step" : undefined}
                            onClick={() => {
                              if (row.step !== s.label) void quickPatch(row.id, { step: s.label });
                            }}
                          >
                            <span className="progress-flow-node" aria-hidden />
                            <span className="progress-flow-label" translate="no">
                              {s.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {row.step && !knownStep ? (
                      <p className="muted small progress-flow-orphan">
                        {t("hunting.progress.step")}: <span translate="no">{row.step}</span>
                      </p>
                    ) : null}
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
        title={t("hunting.progress.deleteTitle")}
        body={t("hunting.progress.confirmDelete")}
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
      <ConfirmDialog
        open={deleteOptionId != null}
        title={t("hunting.progress.deleteOptionTitle")}
        body={t("hunting.progress.confirmDeleteOption")}
        danger
        busy={saving}
        onConfirm={() => {
          if (deleteOptionId) void removeOption(deleteOptionId);
        }}
        onCancel={() => setDeleteOptionId(null)}
      />
    </section>
  );
}
