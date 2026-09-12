import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAlerts } from "../alerts/AlertProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { JobDailyPanel } from "../components/JobDailyPanel";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { toLocalDateInput } from "../lib/datetime";

type Job = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  description: string;
};

const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

export function JobsPage() {
  const { t, i18n } = useTranslation();
  const { notify } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editStatus, setEditStatus] = useState("TODO");
  const [editPriority, setEditPriority] = useState("MEDIUM");
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const activeId = searchParams.get("job");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((j) => {
      if (statusFilter !== "ALL" && j.status !== statusFilter) return false;
      if (!q) return true;
      return (
        j.title.toLowerCase().includes(q) ||
        j.description.toLowerCase().includes(q)
      );
    });
  }, [items, query, statusFilter]);

  const active = items.find((j) => j.id === activeId) ?? null;

  function selectJob(id: string | null) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("job", id);
    else next.delete("job");
    setSearchParams(next, { replace: true });
  }

  async function load(preferId?: string | null) {
    setLoading(true);
    try {
      const data = await api<Job[]>("/jobs");
      setItems(data);
      const fromUrl = searchParams.get("job");
      const next =
        (preferId && data.some((j) => j.id === preferId) && preferId) ||
        (fromUrl && data.some((j) => j.id === fromUrl) && fromUrl) ||
        data[0]?.id ||
        null;
      if (next !== fromUrl) selectJob(next);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount
  }, []);

  useEffect(() => {
    if (!active) {
      setEditTitle("");
      setEditDescription("");
      setEditDue("");
      setEditStatus("TODO");
      setEditPriority("MEDIUM");
      return;
    }
    setEditTitle(active.title);
    setEditDescription(active.description);
    setEditDue(toLocalDateInput(active.dueAt));
    setEditStatus(active.status);
    setEditPriority(active.priority);
  }, [active]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api<Job>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description,
          priority,
          dueAt: dueAt ? new Date(`${dueAt}T09:00:00`).toISOString() : null,
        }),
      });
      setTitle("");
      setDescription("");
      setDueAt("");
      setPriority("MEDIUM");
      setCreating(false);
      await load(created.id);
      notify({
        title: t("jobs.toastCreatedTitle"),
        body: t("jobs.toastCreatedBody", { name: created.title }),
        tone: "success",
        sourceType: "JOB",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onSaveDetails(e: FormEvent) {
    e.preventDefault();
    if (!active) return;
    setSaving(true);
    try {
      await api(`/jobs/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription,
          status: editStatus,
          priority: editPriority,
          dueAt: editDue ? new Date(`${editDue}T09:00:00`).toISOString() : null,
        }),
      });
      setDetailsOpen(false);
      await load(active.id);
      notify({
        title: t("jobs.toastSavedTitle"),
        body: t("jobs.toastSavedBody", { name: editTitle.trim() }),
        tone: "info",
        sourceType: "JOB",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const name = items.find((j) => j.id === id)?.title ?? "";
    setDeleting(true);
    try {
      await api(`/jobs/${id}`, { method: "DELETE" });
      const remaining = items.filter((j) => j.id !== id);
      setItems(remaining);
      selectJob(remaining[0]?.id ?? null);
      setDeleteId(null);
      notify({
        title: t("jobs.toastDeletedTitle"),
        body: t("jobs.toastDeletedBody", { name }),
        tone: "warning",
        sourceType: "JOB",
      });
    } finally {
      setDeleting(false);
    }
  }

  const dueLabel = active?.dueAt
    ? new Date(active.dueAt).toLocaleDateString(i18n.language, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : t("jobs.noDue");

  return (
    <section className="page itsm-page jobs-ops">
      <div className="itsm-page-header">
        <div>
          <h1>{t("jobs.heading")}</h1>
        </div>
        <div className="itsm-header-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? t("common.cancel") : t("jobs.new")}
          </button>
        </div>
      </div>

      {creating && (
        <form className="itsm-create panel" onSubmit={(e) => void onAdd(e)}>
          <header className="itsm-panel-head">
            <h2>{t("jobs.new")}</h2>
          </header>
          <div className="itsm-form-grid">
            <label className="field">
              <span>{t("jobs.client")}</span>
              <input
                name="client"
                autoComplete="organization"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("jobs.clientPlaceholder")}
                required
              />
            </label>
            <label className="field">
              <span>{t("common.priority")}</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`jobs.priority.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("jobs.due")}</span>
              <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </label>
            <label className="field itsm-span-2">
              <span>{t("jobs.description")}</span>
              <input
                name="notes"
                autoComplete="off"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("jobs.description")}
              />
            </label>
          </div>
          <div className="row-actions">
            <button className="btn primary" disabled={saving || !title.trim()}>
              {saving ? t("common.saving") : t("jobs.create")}
            </button>
            <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      <div className="itsm-split">
        <aside className="itsm-catalog panel" aria-label={t("jobs.catalog")}>
          <div className="itsm-catalog-tools">
            <label className="field itsm-search">
              <span className="sr-only">{t("jobs.search")}</span>
              <input
                type="search"
                name="job-search"
                autoComplete="off"
                placeholder={t("jobs.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="sr-only">{t("common.status")}</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t("jobs.filterStatus")}
              >
                <option value="ALL">{t("jobs.filterAll")}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`jobs.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="itsm-catalog-meta">
            <span className="muted small tabular">
              {t("jobs.catalogCount", { count: filtered.length })}
            </span>
          </div>

          {loading && <p className="muted small itsm-pad">{t("common.loading")}</p>}
          {!loading && filtered.length === 0 && (
            <div className="itsm-empty">
              <p>{t("jobs.empty")}</p>
            </div>
          )}

          <ul className="itsm-catalog-list" role="listbox" aria-label={t("jobs.catalog")}>
            {filtered.map((j) => {
              const selected = j.id === activeId;
              return (
                <li key={j.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`itsm-catalog-item${selected ? " active" : ""}`}
                    onClick={() => selectJob(j.id)}
                  >
                    <span className="itsm-catalog-title" translate="no">
                      {j.title}
                    </span>
                    <span className="itsm-catalog-row">
                      <StatusBadge tone={statusTone(j.status)}>
                        {t(`jobs.status.${j.status}`)}
                      </StatusBadge>
                      <StatusBadge tone={statusTone(j.priority)}>
                        {t(`jobs.priority.${j.priority}`)}
                      </StatusBadge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="itsm-workspace">
          {!active ? (
            <div className="panel itsm-empty-workspace">
              <h2>{t("jobs.selectPrompt")}</h2>
            </div>
          ) : (
            <div className="itsm-engagement panel">
              <header className="itsm-engagement-head">
                <div className="itsm-engagement-title">
                  <h2 translate="no">{active.title}</h2>
                  <div className="itsm-badge-row">
                    <StatusBadge tone={statusTone(active.status)}>
                      {t(`jobs.status.${active.status}`)}
                    </StatusBadge>
                    <StatusBadge tone={statusTone(active.priority)}>
                      {t(`jobs.priority.${active.priority}`)}
                    </StatusBadge>
                    <span className="itsm-meta-chip">
                      {t("jobs.due")}: <strong className="tabular">{dueLabel}</strong>
                    </span>
                  </div>
                  {active.description ? (
                    <p className="itsm-engagement-notes muted">{active.description}</p>
                  ) : null}
                </div>
                <div className="itsm-engagement-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setDetailsOpen((v) => !v)}
                    aria-expanded={detailsOpen}
                  >
                    {detailsOpen ? t("jobs.hideDetails") : t("jobs.editDetails")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost danger"
                    onClick={() => setDeleteId(active.id)}
                  >
                    {t("jobs.delete")}
                  </button>
                </div>
              </header>

              {detailsOpen && (
                <form className="itsm-details" onSubmit={(e) => void onSaveDetails(e)}>
                  <div className="itsm-form-grid">
                    <label className="field">
                      <span>{t("jobs.client")}</span>
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        required
                        translate="no"
                      />
                    </label>
                    <label className="field">
                      <span>{t("common.status")}</span>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(`jobs.status.${s}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>{t("common.priority")}</span>
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value)}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {t(`jobs.priority.${p}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>{t("jobs.due")}</span>
                      <input
                        type="date"
                        value={editDue}
                        onChange={(e) => setEditDue(e.target.value)}
                      />
                    </label>
                    <label className="field itsm-span-2">
                      <span>{t("jobs.description")}</span>
                      <input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="row-actions">
                    <button className="btn primary" disabled={saving || !editTitle.trim()}>
                      {saving ? t("common.saving") : t("jobs.saveDetails")}
                    </button>
                  </div>
                </form>
              )}

              <JobDailyPanel jobId={active.id} jobTitle={active.title} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteId != null}
        title={t("jobs.deleteTitle")}
        body={t("jobs.confirmDelete")}
        danger
        busy={deleting}
        onConfirm={() => {
          if (deleteId) void remove(deleteId);
        }}
        onCancel={() => {
          if (!deleting) setDeleteId(null);
        }}
      />
    </section>
  );
}
