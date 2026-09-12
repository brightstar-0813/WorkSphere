import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../auth";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { mediaUrl } from "../config";
import {
  addDays,
  endOfDay,
  eventOccursOnDay,
  formatMonthYear,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "../lib/datetime";

type Tab = "overview" | "users" | "calendar" | "jobs" | "hunting" | "money";

type Overview = {
  users: number;
  events: number;
  jobs: number;
  huntings: number;
  interviews?: number;
  transactions: number;
  jobsByStatus: Record<string, number>;
  bidsByStatus?: Record<string, number>;
  interviewsByStatus?: Record<string, number>;
  huntingsByStage: Record<string, number>;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  locale: string;
  avatarUrl: string | null;
  disabled: boolean;
  createdAt: string;
  _count: {
    jobs: number;
    huntingBids: number;
    huntingInterviews: number;
    transactions: number;
    discussions: number;
    events: number;
  };
};

type Owner = { id: string; name: string; email: string };

type AdminEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay?: boolean;
  sourceType: string;
  description?: string;
  user: Owner;
};

type AdminJob = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  description: string;
  updatedAt: string;
  user: Owner;
  _count: { dayLogs: number };
};

type DayItem = {
  id: string;
  title: string;
  description: string;
  status: string;
};

type DayLog = {
  id: string;
  day: string;
  items: DayItem[];
};

type AdminJobDetail = AdminJob & {
  dayLogs: DayLog[];
};

type AdminHunting = {
  id: string;
  company: string;
  roleTitle: string;
  status: string;
  sourceUrl: string | null;
  notes: string;
  appliedAt: string | null;
  updatedAt: string;
  user: Owner;
  profile?: { id: string; name: string };
};

type AdminTx = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amountMinor: number;
  currency: string;
  category: string;
  occurredAt: string;
  note: string;
  user: Owner;
};

type UserDetail = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  locale: string;
  avatarUrl: string | null;
  disabled: boolean;
  createdAt: string;
  jobs: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: string | null;
    description: string;
    _count: { dayLogs: number };
    dayLogs: DayLog[];
  }>;
  huntingBids: Array<{
    id: string;
    company: string;
    roleTitle: string;
    status: string;
    notes: string;
    appliedAt: string | null;
    profile?: { id: string; name: string };
  }>;
  huntingInterviews: Array<{
    id: string;
    company: string;
    roleTitle: string;
    status: string;
    notes: string;
    scheduledAt: string | null;
    profile?: { id: string; name: string };
  }>;
  transactions: Array<{
    id: string;
    type: "INCOME" | "EXPENSE";
    amountMinor: number;
    currency: string;
    category: string;
    occurredAt: string;
    note: string;
  }>;
  events: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string | null;
    sourceType: string;
  }>;
  discussions: Array<{
    id: string;
    title: string;
    body: string;
    replies: Array<{ id: string; body: string; createdAt: string }>;
  }>;
};

const emptyCreate = {
  name: "",
  email: "",
  password: "",
  role: "USER" as "USER" | "ADMIN",
  locale: "en",
};

const JOB_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
const BID_STATUSES = ["DRAFT", "SENT", "SHORTLISTED", "REJECTED", "WITHDRAWN", "WON"] as const;

function formatMoney(amountMinor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "USD",
  }).format(amountMinor / 100);
}

export function AdminPage() {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [huntings, setHuntings] = useState<AdminHunting[]>([]);
  const [transactions, setTransactions] = useState<AdminTx[]>([]);
  const [filterUserId, setFilterUserId] = useState("");
  const [jobStatusFilter, setJobStatusFilter] = useState("ALL");
  const [huntStageFilter, setHuntStageFilter] = useState("ALL");
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");
  const [jobDetailId, setJobDetailId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<AdminJobDetail | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [calCursor, setCalCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [create, setCreate] = useState(emptyCreate);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    name: "",
    email: "",
    role: "USER" as "USER" | "ADMIN",
    locale: "en",
    disabled: false,
    password: "",
  });

  const loadOverview = useCallback(async () => {
    setOverview(await api<Overview>("/admin/overview"));
  }, []);

  const loadUsers = useCallback(async () => {
    setUsers(await api<UserRow[]>("/admin/users"));
  }, []);

  const loadEvents = useCallback(async () => {
    const monthStart = startOfMonth(calCursor);
    const gridStart = startOfWeek(monthStart);
    const from = gridStart;
    const to = endOfDay(addDays(gridStart, 41));
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (filterUserId) params.set("userId", filterUserId);
    setEvents(await api<AdminEvent[]>(`/admin/events?${params}`));
  }, [calCursor, filterUserId]);

  const loadJobs = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterUserId) params.set("userId", filterUserId);
    if (jobStatusFilter !== "ALL") params.set("status", jobStatusFilter);
    const q = params.toString();
    setJobs(await api<AdminJob[]>(`/admin/jobs${q ? `?${q}` : ""}`));
  }, [filterUserId, jobStatusFilter]);

  const loadHuntings = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterUserId) params.set("userId", filterUserId);
    if (huntStageFilter !== "ALL") params.set("status", huntStageFilter);
    const q = params.toString();
    setHuntings(await api<AdminHunting[]>(`/admin/huntings${q ? `?${q}` : ""}`));
  }, [filterUserId, huntStageFilter]);

  const loadTransactions = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterUserId) params.set("userId", filterUserId);
    if (txTypeFilter !== "ALL") params.set("type", txTypeFilter);
    const q = params.toString();
    setTransactions(await api<AdminTx[]>(`/admin/transactions${q ? `?${q}` : ""}`));
  }, [filterUserId, txTypeFilter]);

  useEffect(() => {
    void loadOverview().catch(() => undefined);
    void loadUsers().catch(() => undefined);
  }, [loadOverview, loadUsers]);

  useEffect(() => {
    if (tab === "calendar") void loadEvents().catch(() => undefined);
    if (tab === "jobs") void loadJobs().catch(() => undefined);
    if (tab === "hunting") void loadHuntings().catch(() => undefined);
    if (tab === "money") void loadTransactions().catch(() => undefined);
  }, [tab, loadEvents, loadJobs, loadHuntings, loadTransactions]);

  useEffect(() => {
    if (!detailUserId) {
      setUserDetail(null);
      return;
    }
    void api<UserDetail>(`/admin/users/${detailUserId}`)
      .then(setUserDetail)
      .catch((err) => setError(err instanceof Error ? err.message : t("common.error")));
  }, [detailUserId, t]);

  useEffect(() => {
    if (!jobDetailId) {
      setJobDetail(null);
      return;
    }
    void api<AdminJobDetail>(`/admin/jobs/${jobDetailId}`)
      .then(setJobDetail)
      .catch((err) => setError(err instanceof Error ? err.message : t("common.error")));
  }, [jobDetailId, t]);

  const userOptions = useMemo(
    () => users.map((u) => ({ id: u.id, label: `${u.name} <${u.email}>` })),
    [users]
  );

  const monthCells = useMemo(() => {
    const monthStart = startOfMonth(calCursor);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [calCursor]);

  const dayEvents = useMemo(
    () => events.filter((ev) => eventOccursOnDay(ev, selectedDay)),
    [events, selectedDay]
  );

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify(create),
      });
      setCreate(emptyCreate);
      await Promise.all([loadUsers(), loadOverview()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(u: UserRow) {
    setEditId(u.id);
    setEdit({
      name: u.name,
      email: u.email,
      role: u.role,
      locale: u.locale,
      disabled: u.disabled,
      password: "",
    });
    setError("");
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: edit.name.trim(),
        email: edit.email.trim(),
        role: edit.role,
        locale: edit.locale,
        disabled: edit.disabled,
      };
      if (edit.password.trim()) body.password = edit.password.trim();
      await api(`/admin/users/${editId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setEditId(null);
      await Promise.all([loadUsers(), loadOverview()]);
      if (detailUserId === editId) {
        setUserDetail(await api<UserDetail>(`/admin/users/${editId}`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled(u: UserRow) {
    if (u.id === me?.id) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: !u.disabled }),
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(u: UserRow) {
    if (u.id === me?.id) return;
    if (!window.confirm(t("admin.confirmDelete", { name: u.name }))) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/users/${u.id}`, { method: "DELETE" });
      if (editId === u.id) setEditId(null);
      if (detailUserId === u.id) setDetailUserId(null);
      await Promise.all([loadUsers(), loadOverview()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(i18n.language, { dateStyle: "medium" });
  }

  const filterBar = (
    <div className="admin-events-toolbar">
      <label className="field">
        <span>{t("admin.filterUser")}</span>
        <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
          <option value="">{t("admin.allUsers")}</option>
          {userOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <section className="page admin-page">
      <header className="page-header">
        <div>
          <h1>{t("admin.heading")}</h1>
          <p className="muted">{t("admin.subtitle")}</p>
        </div>
      </header>

      <div className="admin-tabs" role="tablist">
        {(
          [
            ["overview", "admin.tabOverview"],
            ["calendar", "admin.tabCalendar"],
            ["jobs", "admin.tabJobs"],
            ["hunting", "admin.tabHunting"],
            ["money", "admin.tabMoney"],
            ["users", "admin.tabUsers"],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`admin-tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {tab === "overview" && (
        <div className="stack admin-overview">
          <div className="admin-metrics">
            {(
              [
                ["users", overview?.users],
                ["events", overview?.events],
                ["jobs", overview?.jobs],
                ["huntings", overview?.huntings],
                ["interviews", overview?.interviews],
                ["transactions", overview?.transactions],
              ] as const
            ).map(([key, value]) => (
              <article key={key} className="panel admin-metric">
                <span className="muted small">{t(`admin.metric.${key}`)}</span>
                <strong className="tabular">{value ?? "—"}</strong>
              </article>
            ))}
          </div>

          <div className="admin-breakdown-grid">
            <article className="panel">
              <h2>{t("admin.jobsByStatus")}</h2>
              <div className="admin-status-list">
                {JOB_STATUSES.map((s) => (
                  <div key={s} className="admin-status-row">
                    <StatusBadge tone={statusTone(s)}>{s}</StatusBadge>
                    <strong className="tabular">{overview?.jobsByStatus?.[s] ?? 0}</strong>
                  </div>
                ))}
              </div>
            </article>
            <article className="panel">
              <h2>{t("admin.huntingsByStage")}</h2>
              <div className="admin-status-list">
                {BID_STATUSES.map((s) => (
                  <div key={s} className="admin-status-row">
                    <StatusBadge tone="info">{s}</StatusBadge>
                    <strong className="tabular">
                      {overview?.bidsByStatus?.[s] ?? overview?.huntingsByStage?.[s] ?? 0}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      )}

      {tab === "users" && !detailUserId && (
        <div className="admin-users-layout">
          <article className="panel">
            <h2>{t("admin.createUser")}</h2>
            <form className="stack" onSubmit={(e) => void onCreate(e)}>
              <label className="field">
                <span>{t("auth.name")}</span>
                <input
                  value={create.name}
                  onChange={(e) => setCreate((c) => ({ ...c, name: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>{t("auth.email")}</span>
                <input
                  type="email"
                  value={create.email}
                  onChange={(e) => setCreate((c) => ({ ...c, email: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>{t("auth.password")}</span>
                <input
                  type="password"
                  value={create.password}
                  onChange={(e) => setCreate((c) => ({ ...c, password: e.target.value }))}
                  minLength={6}
                  required
                />
              </label>
              <div className="admin-inline-fields">
                <label className="field">
                  <span>{t("common.role")}</span>
                  <select
                    value={create.role}
                    onChange={(e) =>
                      setCreate((c) => ({ ...c, role: e.target.value as "USER" | "ADMIN" }))
                    }
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("common.language")}</span>
                  <select
                    value={create.locale}
                    onChange={(e) => setCreate((c) => ({ ...c, locale: e.target.value }))}
                  >
                    <option value="en">EN</option>
                    <option value="zh">ZH</option>
                    <option value="ru">RU</option>
                  </select>
                </label>
              </div>
              <button className="btn primary" disabled={busy}>
                {t("admin.create")}
              </button>
            </form>
          </article>

          <div className="admin-user-list">
            {users.map((u) => (
              <article key={u.id} className={`panel admin-user-row${u.disabled ? " disabled" : ""}`}>
                <div className="admin-user-main">
                  <div className="admin-user-avatar">
                    {u.avatarUrl ? (
                      <img src={mediaUrl(u.avatarUrl)} alt="" />
                    ) : (
                      <span>{u.name.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <strong>
                      {u.name}{" "}
                      <span className="role-badge">{u.role}</span>
                      {u.disabled && (
                        <span className="status-pill danger">{t("admin.disabled")}</span>
                      )}
                    </strong>
                    <p className="muted small">
                      {u.email} ·{" "}
                      {t("admin.counts", {
                        jobs: u._count.jobs,
                        events: u._count.events,
                        huntings: u._count.huntingBids,
                      })}
                    </p>
                  </div>
                </div>
                <div className="admin-user-actions">
                  <button type="button" className="btn primary" onClick={() => setDetailUserId(u.id)}>
                    {t("admin.view")}
                  </button>
                  <button type="button" className="btn" onClick={() => startEdit(u)}>
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || u.id === me?.id}
                    onClick={() => void toggleDisabled(u)}
                  >
                    {u.disabled ? t("admin.enable") : t("admin.disable")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || u.id === me?.id}
                    onClick={() => void onDelete(u)}
                  >
                    {t("common.delete")}
                  </button>
                </div>

                {editId === u.id && (
                  <form className="admin-edit-form stack" onSubmit={(e) => void onSaveEdit(e)}>
                    <label className="field">
                      <span>{t("auth.name")}</span>
                      <input
                        value={edit.name}
                        onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("auth.email")}</span>
                      <input
                        type="email"
                        value={edit.email}
                        onChange={(e) => setEdit((x) => ({ ...x, email: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("admin.newPassword")}</span>
                      <input
                        type="password"
                        value={edit.password}
                        onChange={(e) => setEdit((x) => ({ ...x, password: e.target.value }))}
                        placeholder={t("admin.passwordOptional")}
                        minLength={6}
                      />
                    </label>
                    <div className="admin-inline-fields">
                      <label className="field">
                        <span>{t("common.role")}</span>
                        <select
                          value={edit.role}
                          onChange={(e) =>
                            setEdit((x) => ({ ...x, role: e.target.value as "USER" | "ADMIN" }))
                          }
                          disabled={u.id === me?.id}
                        >
                          <option value="USER">USER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>{t("common.language")}</span>
                        <select
                          value={edit.locale}
                          onChange={(e) => setEdit((x) => ({ ...x, locale: e.target.value }))}
                        >
                          <option value="en">EN</option>
                          <option value="zh">ZH</option>
                          <option value="ru">RU</option>
                        </select>
                      </label>
                      <label className="field checkbox-field">
                        <span>{t("admin.disabled")}</span>
                        <input
                          type="checkbox"
                          checked={edit.disabled}
                          disabled={u.id === me?.id}
                          onChange={(e) => setEdit((x) => ({ ...x, disabled: e.target.checked }))}
                        />
                      </label>
                    </div>
                    <div className="admin-user-actions">
                      <button className="btn primary" disabled={busy}>
                        {t("common.save")}
                      </button>
                      <button type="button" className="btn ghost" onClick={() => setEditId(null)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "users" && detailUserId && (
        <div className="stack admin-user-detail">
          <div className="admin-user-actions">
            <button type="button" className="btn" onClick={() => setDetailUserId(null)}>
              {t("admin.back")}
            </button>
          </div>
          {!userDetail && <p className="muted">{t("common.loading")}</p>}
          {userDetail && (
            <>
              <article className="panel">
                <div className="admin-user-main">
                  <div className="admin-user-avatar lg">
                    {userDetail.avatarUrl ? (
                      <img src={mediaUrl(userDetail.avatarUrl)} alt="" />
                    ) : (
                      <span>{userDetail.name.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <h2>
                      {userDetail.name} <span className="role-badge">{userDetail.role}</span>
                      {userDetail.disabled && (
                        <span className="status-pill danger">{t("admin.disabled")}</span>
                      )}
                    </h2>
                    <p className="muted">
                      {userDetail.email} · {userDetail.locale.toUpperCase()} ·{" "}
                      {fmtDate(userDetail.createdAt)}
                    </p>
                  </div>
                </div>
              </article>

              <article className="panel">
                <h3>{t("admin.sectionJobs")}</h3>
                {userDetail.jobs.length === 0 && <p className="muted">{t("common.empty")}</p>}
                <div className="list">
                  {userDetail.jobs.map((j) => (
                    <div key={j.id} className="admin-detail-block">
                      <div className="admin-detail-head">
                        <strong>{j.title}</strong>
                        <StatusBadge tone={statusTone(j.status)}>{j.status}</StatusBadge>
                        <StatusBadge tone={statusTone(j.priority)}>{j.priority}</StatusBadge>
                      </div>
                      {j.description && <p className="muted small">{j.description}</p>}
                      <p className="muted small">
                        {t("common.due")}: {j.dueAt ? fmtDate(j.dueAt) : "—"} ·{" "}
                        {t("admin.dayLogs", { count: j._count.dayLogs })}
                      </p>
                      {j.dayLogs.map((log) => (
                        <div key={log.id} className="admin-day-log">
                          <span className="muted small tabular">{fmtDate(log.day)}</span>
                          <ul>
                            {log.items.map((it) => (
                              <li key={it.id}>
                                <StatusBadge tone={statusTone(it.status)}>{it.status}</StatusBadge>{" "}
                                {it.title}
                                {it.description ? (
                                  <span className="muted"> — {it.description}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <h3>{t("admin.sectionEvents")}</h3>
                {userDetail.events.length === 0 && <p className="muted">{t("common.empty")}</p>}
                <div className="list">
                  {userDetail.events.map((ev) => (
                    <article key={ev.id} className="row admin-event-row">
                      <div>
                        <strong>{ev.title}</strong>
                        <p className="muted small">{ev.sourceType}</p>
                      </div>
                      <time className="muted small tabular">{fmt(ev.startsAt)}</time>
                    </article>
                  ))}
                </div>
              </article>

              <article className="panel">
                <h3>{t("admin.sectionHunting")}</h3>
                {userDetail.huntingBids.length === 0 && <p className="muted">{t("common.empty")}</p>}
                <div className="list">
                  {userDetail.huntingBids.map((h) => (
                    <article key={h.id} className="row">
                      <div>
                        <strong>
                          {h.company} — {h.roleTitle}
                        </strong>
                        <p className="muted small">
                          {h.profile?.name ? `${h.profile.name} · ` : ""}
                          {h.notes || "—"}
                        </p>
                      </div>
                      <StatusBadge tone="info">{h.status}</StatusBadge>
                    </article>
                  ))}
                </div>
                <h3 style={{ marginTop: "1rem" }}>{t("nav.huntingInterviews")}</h3>
                {userDetail.huntingInterviews.length === 0 && (
                  <p className="muted">{t("common.empty")}</p>
                )}
                <div className="list">
                  {userDetail.huntingInterviews.map((h) => (
                    <article key={h.id} className="row">
                      <div>
                        <strong>
                          {h.company} — {h.roleTitle}
                        </strong>
                        <p className="muted small">
                          {h.profile?.name ? `${h.profile.name} · ` : ""}
                          {h.notes || "—"}
                        </p>
                      </div>
                      <StatusBadge tone="info">{h.status}</StatusBadge>
                    </article>
                  ))}
                </div>
              </article>

              <article className="panel">
                <h3>{t("admin.sectionMoney")}</h3>
                {userDetail.transactions.length === 0 && (
                  <p className="muted">{t("common.empty")}</p>
                )}
                <div className="list">
                  {userDetail.transactions.map((tx) => (
                    <article key={tx.id} className="row">
                      <div>
                        <strong>
                          {tx.type} · {tx.category}
                        </strong>
                        <p className="muted small">{tx.note || fmtDate(tx.occurredAt)}</p>
                      </div>
                      <strong className="tabular">
                        {formatMoney(tx.amountMinor, tx.currency, i18n.language)}
                      </strong>
                    </article>
                  ))}
                </div>
              </article>

              <article className="panel">
                <h3>{t("admin.sectionDiscuss")}</h3>
                {userDetail.discussions.length === 0 && (
                  <p className="muted">{t("common.empty")}</p>
                )}
                <div className="list">
                  {userDetail.discussions.map((d) => (
                    <div key={d.id} className="admin-detail-block">
                      <strong>{d.title}</strong>
                      <p className="muted small">{d.body}</p>
                      {d.replies.length > 0 && (
                        <ul className="admin-reply-list">
                          {d.replies.map((r) => (
                            <li key={r.id}>
                              <span className="muted small">{fmt(r.createdAt)}: </span>
                              {r.body}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            </>
          )}
        </div>
      )}

      {tab === "calendar" && (
        <div className="admin-calendar">
          {filterBar}
          <div className="cal-toolbar">
            <div className="cal-nav">
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  setCalCursor(new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1))
                }
              >
                ‹
              </button>
              <strong className="cal-period">{formatMonthYear(calCursor, i18n.language)}</strong>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  setCalCursor(new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1))
                }
              >
                ›
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const today = startOfDay(new Date());
                  setCalCursor(startOfMonth(today));
                  setSelectedDay(today);
                }}
              >
                {t("admin.today")}
              </button>
              <button type="button" className="btn" onClick={() => void loadEvents()}>
                {t("admin.refresh")}
              </button>
            </div>
          </div>

          <div className="admin-cal-layout">
            <div className="panel cal-main">
              <div className="cal-weekdays">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="cal-weekday">
                    {addDays(startOfWeek(new Date()), i).toLocaleDateString(i18n.language, {
                      weekday: "short",
                    })}
                  </div>
                ))}
              </div>
              <div className="cal-month-grid">
                {monthCells.map((day) => {
                  const inMonth = day.getMonth() === calCursor.getMonth();
                  const dayEvs = events.filter((ev) => eventOccursOnDay(ev, day));
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      className={`cal-cell${inMonth ? "" : " muted-month"}${
                        sameDay(day, selectedDay) ? " selected" : ""
                      }${sameDay(day, new Date()) ? " today" : ""}`}
                      onClick={() => setSelectedDay(startOfDay(day))}
                    >
                      <span className="cal-date">{day.getDate()}</span>
                      <div className="cal-chips">
                        {dayEvs.slice(0, 3).map((ev) => (
                          <span
                            key={ev.id}
                            className={`cal-chip src-${ev.sourceType.toLowerCase()}`}
                            title={`${ev.user.name}: ${ev.title}`}
                          >
                            {ev.user.name.split(" ")[0]}: {ev.title}
                          </span>
                        ))}
                        {dayEvs.length > 3 && (
                          <span className="cal-more">+{dayEvs.length - 3}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="panel cal-agenda">
              <h3>
                {selectedDay.toLocaleDateString(i18n.language, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h3>
              {dayEvents.length === 0 && <p className="muted">{t("admin.noEvents")}</p>}
              <div className="list">
                {dayEvents.map((ev) => (
                  <article key={ev.id} className="admin-agenda-item">
                    <strong>{ev.title}</strong>
                    <p className="muted small">
                      {ev.user.name} · {ev.user.email} · {ev.sourceType}
                    </p>
                    <time className="muted small tabular">{fmt(ev.startsAt)}</time>
                    {ev.description && <p className="small">{ev.description}</p>}
                  </article>
                ))}
              </div>
            </aside>
          </div>
        </div>
      )}

      {tab === "jobs" && (
        <div className="admin-jobs">
          <div className="admin-events-toolbar">
            <label className="field">
              <span>{t("admin.filterUser")}</span>
              <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
                <option value="">{t("admin.allUsers")}</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("common.status")}</span>
              <select value={jobStatusFilter} onChange={(e) => setJobStatusFilter(e.target.value)}>
                <option value="ALL">{t("admin.allStatuses")}</option>
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => void loadJobs()}>
              {t("admin.refresh")}
            </button>
          </div>

          {jobs.length === 0 && <p className="muted">{t("common.empty")}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("common.title")}</th>
                  <th>{t("admin.owner")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.priority")}</th>
                  <th>{t("common.due")}</th>
                  <th>{t("admin.dayLogsShort")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className={jobDetailId === j.id ? "active" : ""}>
                    <td>
                      <strong>{j.title}</strong>
                      {j.description && <p className="muted small">{j.description}</p>}
                    </td>
                    <td>
                      <span>{j.user.name}</span>
                      <p className="muted small">{j.user.email}</p>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(j.status)}>{j.status}</StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(j.priority)}>{j.priority}</StatusBadge>
                    </td>
                    <td className="tabular">{j.dueAt ? fmtDate(j.dueAt) : "—"}</td>
                    <td className="tabular">{j._count.dayLogs}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          setJobDetailId((id) => (id === j.id ? null : j.id))
                        }
                      >
                        {jobDetailId === j.id ? t("admin.hideDetail") : t("admin.view")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {jobDetailId && jobDetail && (
            <article className="panel admin-job-detail">
              <header className="admin-detail-head">
                <h3>{jobDetail.title}</h3>
                <StatusBadge tone={statusTone(jobDetail.status)}>{jobDetail.status}</StatusBadge>
                <StatusBadge tone={statusTone(jobDetail.priority)}>
                  {jobDetail.priority}
                </StatusBadge>
              </header>
              <p className="muted small">
                {jobDetail.user.name} · {jobDetail.user.email}
              </p>
              {jobDetail.description && <p>{jobDetail.description}</p>}
              <h4>{t("admin.recentWork")}</h4>
              {jobDetail.dayLogs.length === 0 && <p className="muted">{t("common.empty")}</p>}
              {jobDetail.dayLogs.map((log) => (
                <div key={log.id} className="admin-day-log">
                  <strong className="tabular">{fmtDate(log.day)}</strong>
                  <ul>
                    {log.items.map((it) => (
                      <li key={it.id}>
                        <StatusBadge tone={statusTone(it.status)}>{it.status}</StatusBadge>{" "}
                        <strong>{it.title}</strong>
                        {it.description ? (
                          <span className="muted"> — {it.description}</span>
                        ) : null}
                      </li>
                    ))}
                    {log.items.length === 0 && (
                      <li className="muted">{t("admin.noDayItems")}</li>
                    )}
                  </ul>
                </div>
              ))}
            </article>
          )}
        </div>
      )}

      {tab === "hunting" && (
        <div className="admin-hunting">
          <div className="admin-events-toolbar">
            <label className="field">
              <span>{t("admin.filterUser")}</span>
              <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
                <option value="">{t("admin.allUsers")}</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("common.status")}</span>
              <select value={huntStageFilter} onChange={(e) => setHuntStageFilter(e.target.value)}>
                <option value="ALL">{t("admin.allStages")}</option>
                {BID_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => void loadHuntings()}>
              {t("admin.refresh")}
            </button>
          </div>
          {huntings.length === 0 && <p className="muted">{t("common.empty")}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("common.company")}</th>
                  <th>{t("common.role")}</th>
                  <th>{t("hunting.profile.label")}</th>
                  <th>{t("admin.owner")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("admin.applied")}</th>
                  <th>{t("common.notes")}</th>
                </tr>
              </thead>
              <tbody>
                {huntings.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.company}</strong>
                      {h.sourceUrl && (
                        <p className="muted small">
                          <a href={h.sourceUrl} target="_blank" rel="noreferrer">
                            {h.sourceUrl}
                          </a>
                        </p>
                      )}
                    </td>
                    <td>{h.roleTitle}</td>
                    <td>{h.profile?.name ?? "—"}</td>
                    <td>
                      {h.user.name}
                      <p className="muted small">{h.user.email}</p>
                    </td>
                    <td>
                      <StatusBadge tone="info">{h.status}</StatusBadge>
                    </td>
                    <td className="tabular">
                      {h.appliedAt ? fmtDate(h.appliedAt) : "—"}
                    </td>
                    <td className="muted small">{h.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "money" && (
        <div className="admin-money">
          <div className="admin-events-toolbar">
            <label className="field">
              <span>{t("admin.filterUser")}</span>
              <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
                <option value="">{t("admin.allUsers")}</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("common.type")}</span>
              <select value={txTypeFilter} onChange={(e) => setTxTypeFilter(e.target.value)}>
                <option value="ALL">{t("admin.allTypes")}</option>
                <option value="INCOME">{t("common.income")}</option>
                <option value="EXPENSE">{t("common.expense")}</option>
              </select>
            </label>
            <button type="button" className="btn" onClick={() => void loadTransactions()}>
              {t("admin.refresh")}
            </button>
          </div>
          {transactions.length === 0 && <p className="muted">{t("common.empty")}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("common.type")}</th>
                  <th>{t("common.category")}</th>
                  <th>{t("admin.owner")}</th>
                  <th>{t("common.amount")}</th>
                  <th>{t("admin.occurred")}</th>
                  <th>{t("common.notes")}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <StatusBadge tone={tx.type === "INCOME" ? "success" : "danger"}>
                        {tx.type}
                      </StatusBadge>
                    </td>
                    <td>{tx.category}</td>
                    <td>
                      {tx.user.name}
                      <p className="muted small">{tx.user.email}</p>
                    </td>
                    <td className="tabular">
                      {formatMoney(tx.amountMinor, tx.currency, i18n.language)}
                    </td>
                    <td className="tabular">{fmtDate(tx.occurredAt)}</td>
                    <td className="muted small">{tx.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
