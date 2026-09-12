import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiList } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HuntingProfileSwitcher } from "../components/HuntingProfileSwitcher";
import { Pagination } from "../components/Pagination";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { HuntingCapturePanel } from "../components/HuntingCapturePanel";

const FETCH_STATUSES = ["NEW", "QUEUED", "DISMISSED", "BIDDED"] as const;
const PAGE_SIZE = 10;

type Captured = {
  id: string;
  profileId: string;
  title: string;
  company: string;
  sourceUrl: string | null;
  salary: string;
  description: string;
  platform: string;
  status: (typeof FETCH_STATUSES)[number];
  capturedAt: string;
};

export function HuntingFetchPage() {
  const { t, i18n } = useTranslation();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<Captured[]>([]);
  const [countsByStatus, setCountsByStatus] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [salary, setSalary] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [profileId, statusFilter, debouncedQuery]);

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
        profileId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (statusFilter === "OPEN") params.set("open", "true");
      else if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);
      const { data, meta } = await apiList<Captured[]>(`/hunting/fetch?${params}`);
      setItems(data);
      setTotal(meta.total);
      setTotalPages(meta.totalPages);
      setCountsByStatus(meta.countsByStatus ?? {});
      if (page > meta.totalPages && meta.totalPages > 0) setPage(meta.totalPages);
    } finally {
      setLoading(false);
    }
  }, [profileId, page, statusFilter, debouncedQuery, reloadToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTotal = useMemo(
    () => (countsByStatus.NEW ?? 0) + (countsByStatus.QUEUED ?? 0),
    [countsByStatus],
  );
  const pipelineTotal = useMemo(
    () => FETCH_STATUSES.reduce((sum, s) => sum + (countsByStatus[s] ?? 0), 0),
    [countsByStatus],
  );

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!profileId) return;
    setSaving(true);
    try {
      await api("/hunting/fetch", {
        method: "POST",
        body: JSON.stringify({
          profileId,
          title,
          company,
          sourceUrl: sourceUrl || null,
          salary,
          description,
        }),
      });
      setTitle("");
      setCompany("");
      setSourceUrl("");
      setSalary("");
      setDescription("");
      setCreating(false);
      setStatusFilter("OPEN");
      setPage(1);
      setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    await api(`/hunting/fetch/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setReloadToken((n) => n + 1);
  }

  async function promote(id: string) {
    setSaving(true);
    try {
      await api(`/hunting/fetch/${id}/promote`, {
        method: "POST",
        body: JSON.stringify({ pushToSheet: false }),
      });
      setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await api(`/hunting/fetch/${id}`, { method: "DELETE" });
      setDeleteId(null);
      if (items.length === 1 && page > 1) setPage((p) => p - 1);
      else setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page hunting-page">
      <div className="page-header hunting-page-header">
        <div>
          <h1>{t("hunting.fetch.heading")}</h1>
          <p className="muted">{t("hunting.fetch.subtitle")}</p>
        </div>
        {profileId && (
          <div className="itsm-header-actions">
            <button type="button" className="btn primary" onClick={() => setCreating((v) => !v)}>
              {creating ? t("common.cancel") : t("hunting.fetch.new")}
            </button>
          </div>
        )}
      </div>

      <HuntingProfileSwitcher profileId={profileId} onProfileIdChange={setProfileId} />
      <HuntingCapturePanel profileId={profileId} onSynced={() => setReloadToken((n) => n + 1)} />

      {!profileId ? (
        <div className="empty-state hunting-empty">
          <p>{t("hunting.profile.needProfile")}</p>
        </div>
      ) : (
        <>
          <div className="hunting-kpi" role="group" aria-label={t("hunting.fetch.pipeline")}>
            <button
              type="button"
              className={`hunting-kpi-card${statusFilter === "OPEN" ? " active" : ""}`}
              onClick={() => setStatusFilter("OPEN")}
            >
              <span className="hunting-kpi-label">{t("hunting.fetch.filterOpen")}</span>
              <strong className="tabular">{openTotal}</strong>
            </button>
            <button
              type="button"
              className={`hunting-kpi-card${statusFilter === "ALL" ? " active" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              <span className="hunting-kpi-label">{t("hunting.fetch.filterAll")}</span>
              <strong className="tabular">{pipelineTotal}</strong>
            </button>
            {FETCH_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`hunting-kpi-card${statusFilter === s ? " active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                <span className="hunting-kpi-label">{t(`hunting.fetch.status.${s}`)}</span>
                <strong className="tabular">{countsByStatus[s] ?? 0}</strong>
              </button>
            ))}
          </div>

          {creating && (
            <form className="panel hunting-create" onSubmit={(e) => void onAdd(e)}>
              <header className="hunting-panel-head">
                <h2>{t("hunting.fetch.new")}</h2>
                <p className="muted small">{t("hunting.fetch.createHint")}</p>
              </header>
              <div className="hunting-form-grid">
                <label className="field">
                  <span>{t("hunting.fetch.title")}</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("hunting.fetch.titlePlaceholder")}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("common.company")}</span>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder={t("hunting.bids.companyPlaceholder")}
                    autoComplete="organization"
                  />
                </label>
                <label className="field">
                  <span>{t("hunting.bids.url")}</span>
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://"
                    inputMode="url"
                  />
                </label>
                <label className="field">
                  <span>{t("hunting.bids.amount")}</span>
                  <input
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    placeholder={t("hunting.fetch.salaryPlaceholder")}
                  />
                </label>
                <label className="field hunting-span-2">
                  <span>{t("common.notes")}</span>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("hunting.fetch.notesPlaceholder")}
                  />
                </label>
              </div>
              <div className="row-actions">
                <button className="btn primary" type="submit" disabled={saving}>
                  {saving ? t("common.saving") : t("hunting.fetch.create")}
                </button>
                <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}

          <div className="hunting-toolbar panel">
            <label className="field hunting-search">
              <span className="sr-only">{t("hunting.fetch.search")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("hunting.fetch.searchPlaceholder")}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span className="sr-only">{t("common.status")}</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t("hunting.fetch.filterStatus")}
              >
                <option value="OPEN">{t("hunting.fetch.filterOpen")}</option>
                <option value="ALL">{t("hunting.fetch.filterAll")}</option>
                {FETCH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`hunting.fetch.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small tabular hunting-result-count">
              {t("hunting.fetch.resultCount", { count: total })}
            </p>
          </div>

          <div className="hunting-list">
            {loading && <p className="muted small hunting-pad">{t("common.loading")}</p>}
            {!loading && items.length === 0 && (
              <div className="empty-state hunting-empty">
                <p>{t("hunting.fetch.empty")}</p>
              </div>
            )}
            {!loading &&
              items.map((job) => (
                <article key={job.id} className="panel hunting-card">
                  <div className="hunting-card-main">
                    <div className="hunting-card-copy">
                      <div className="hunting-card-title-row">
                        <h3 translate="no">
                          {job.company ? (
                            <>
                              {job.company}
                              <span className="hunting-card-sep">—</span>
                            </>
                          ) : null}
                          {job.title}
                        </h3>
                        <StatusBadge tone={statusTone(job.status)}>
                          {t(`hunting.fetch.status.${job.status}`)}
                        </StatusBadge>
                      </div>
                      {job.description ? (
                        <p className="muted hunting-card-notes">{job.description}</p>
                      ) : null}
                      <div className="hunting-card-meta">
                        {job.salary ? <span className="hunting-meta-chip">{job.salary}</span> : null}
                        {job.platform ? (
                          <span className="hunting-meta-chip">{job.platform}</span>
                        ) : null}
                        <span className="hunting-meta-chip tabular">
                          {new Date(job.capturedAt).toLocaleDateString(i18n.language, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        {job.sourceUrl && (
                          <a
                            className="hunting-meta-link"
                            href={job.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("hunting.bids.openJob")}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="hunting-card-actions">
                      <label className="field hunting-status-field">
                        <span className="sr-only">{t("common.status")}</span>
                        <select
                          value={job.status}
                          onChange={(e) => void updateStatus(job.id, e.target.value)}
                          aria-label={t("common.status")}
                        >
                          {FETCH_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(`hunting.fetch.status.${s}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {job.status !== "BIDDED" && (
                        <button
                          className="btn primary"
                          type="button"
                          disabled={saving}
                          onClick={() => void promote(job.id)}
                        >
                          {t("hunting.fetch.promote")}
                        </button>
                      )}
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setDeleteId(job.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
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
        title={t("hunting.fetch.deleteTitle")}
        body={t("hunting.fetch.confirmDelete")}
        danger
        busy={saving}
        onConfirm={() => {
          if (deleteId) void remove(deleteId);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </section>
  );
}
