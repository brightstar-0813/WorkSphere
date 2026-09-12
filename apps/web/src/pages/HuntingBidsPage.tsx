import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiList } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HuntingProfileSwitcher } from "../components/HuntingProfileSwitcher";
import { HuntingSheetPanel } from "../components/HuntingSheetPanel";
import { Pagination } from "../components/Pagination";
import { StatusBadge, statusTone } from "../components/StatusBadge";

const BID_STATUSES = ["DRAFT", "SENT", "SHORTLISTED", "REJECTED", "WITHDRAWN", "WON"] as const;
const PAGE_SIZE = 10;

type Bid = {
  id: string;
  profileId: string;
  company: string;
  roleTitle: string;
  status: (typeof BID_STATUSES)[number];
  sourceUrl: string | null;
  notes: string;
  salary?: string;
  amountMinor: number | null;
  currency: string;
  appliedAt: string | null;
  updatedAt?: string;
};

function formatMoney(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function HuntingBidsPage() {
  const { t } = useTranslation();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<Bid[]>([]);
  const [countsByStatus, setCountsByStatus] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");

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
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);
      const { data, meta } = await apiList<Bid[]>(`/hunting/bids?${params}`);
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

  const pipelineTotal = useMemo(
    () => BID_STATUSES.reduce((sum, s) => sum + (countsByStatus[s] ?? 0), 0),
    [countsByStatus],
  );

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!profileId) return;
    const amountMinor =
      amount.trim() === "" ? null : Math.round(Number.parseFloat(amount) * 100);
    setSaving(true);
    try {
      await api("/hunting/bids", {
        method: "POST",
        body: JSON.stringify({
          profileId,
          company,
          roleTitle,
          status: "DRAFT",
          sourceUrl: sourceUrl || null,
          notes,
          amountMinor: Number.isFinite(amountMinor) ? amountMinor : null,
        }),
      });
      setCompany("");
      setRoleTitle("");
      setSourceUrl("");
      setNotes("");
      setAmount("");
      setCreating(false);
      setStatusFilter("ALL");
      setPage(1);
      setReloadToken((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    await api(`/hunting/bids/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setReloadToken((n) => n + 1);
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await api(`/hunting/bids/${id}`, { method: "DELETE" });
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
          <h1>{t("hunting.bids.heading")}</h1>
          <p className="muted">{t("hunting.bids.subtitle")}</p>
        </div>
        {profileId && (
          <div className="itsm-header-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => setCreating((v) => !v)}
            >
              {creating ? t("common.cancel") : t("hunting.bids.new")}
            </button>
          </div>
        )}
      </div>

      <HuntingProfileSwitcher profileId={profileId} onProfileIdChange={setProfileId} />
      <HuntingSheetPanel profileId={profileId} onSynced={() => setReloadToken((n) => n + 1)} />

      {!profileId ? (
        <div className="empty-state hunting-empty">
          <p>{t("hunting.profile.needProfile")}</p>
        </div>
      ) : (
        <>
          <div className="hunting-kpi" role="group" aria-label={t("hunting.bids.pipeline")}>
            <button
              type="button"
              className={`hunting-kpi-card${statusFilter === "ALL" ? " active" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              <span className="hunting-kpi-label">{t("hunting.bids.filterAll")}</span>
              <strong className="tabular">{pipelineTotal}</strong>
            </button>
            {BID_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`hunting-kpi-card${statusFilter === s ? " active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                <span className="hunting-kpi-label">{t(`hunting.bids.status.${s}`)}</span>
                <strong className="tabular">{countsByStatus[s] ?? 0}</strong>
              </button>
            ))}
          </div>

          {creating && (
            <form className="panel hunting-create" onSubmit={(e) => void onAdd(e)}>
              <header className="hunting-panel-head">
                <h2>{t("hunting.bids.new")}</h2>
                <p className="muted small">{t("hunting.bids.createHint")}</p>
              </header>
              <div className="hunting-form-grid">
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </label>
                <label className="field hunting-span-2">
                  <span>{t("common.notes")}</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("hunting.bids.notesPlaceholder")}
                  />
                </label>
              </div>
              <div className="row-actions">
                <button className="btn primary" type="submit" disabled={saving}>
                  {saving ? t("common.saving") : t("hunting.bids.create")}
                </button>
                <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}

          <div className="hunting-toolbar panel">
            <label className="field hunting-search">
              <span className="sr-only">{t("hunting.bids.search")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("hunting.bids.searchPlaceholder")}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span className="sr-only">{t("common.status")}</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t("hunting.bids.filterStatus")}
              >
                <option value="ALL">{t("hunting.bids.filterAll")}</option>
                {BID_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`hunting.bids.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small tabular hunting-result-count">
              {t("hunting.bids.resultCount", { count: total })}
            </p>
          </div>

          <div className="hunting-list">
            {loading && <p className="muted small hunting-pad">{t("common.loading")}</p>}
            {!loading && items.length === 0 && (
              <div className="empty-state hunting-empty">
                <p>{t("hunting.bids.empty")}</p>
              </div>
            )}
            {!loading &&
              items.map((b) => (
                <article key={b.id} className="panel hunting-card">
                  <div className="hunting-card-main">
                    <div className="hunting-card-copy">
                      <div className="hunting-card-title-row">
                        <h3 translate="no">
                          {b.company}
                          <span className="hunting-card-sep">—</span>
                          {b.roleTitle}
                        </h3>
                        <StatusBadge tone={statusTone(b.status)}>
                          {t(`hunting.bids.status.${b.status}`)}
                        </StatusBadge>
                      </div>
                      {b.notes ? <p className="muted hunting-card-notes">{b.notes}</p> : null}
                      <div className="hunting-card-meta">
                        {b.amountMinor != null && (
                          <span className="tabular hunting-meta-chip">
                            {formatMoney(b.amountMinor, b.currency)}
                          </span>
                        )}
                        {b.salary ? <span className="hunting-meta-chip">{b.salary}</span> : null}
                        {b.sourceUrl && (
                          <a
                            className="hunting-meta-link"
                            href={b.sourceUrl}
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
                          value={b.status}
                          onChange={(e) => void updateStatus(b.id, e.target.value)}
                          aria-label={t("common.status")}
                        >
                          {BID_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(`hunting.bids.status.${s}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setDeleteId(b.id)}
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
        title={t("hunting.bids.deleteTitle")}
        body={t("hunting.bids.confirmDelete")}
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
