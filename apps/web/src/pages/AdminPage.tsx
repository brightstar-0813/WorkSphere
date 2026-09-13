import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../auth";
import { useAlerts } from "../alerts/AlertProvider";
import { AlertBanner } from "../components/AlertBanner";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MoneyCharts } from "../components/MoneyCharts";
import { PageHeader } from "../components/PageHeader";
import { PasswordField } from "../components/PasswordField";
import {
  PeriodToolbar,
  PERIODS,
  parseDateKey,
  periodLabel,
  toDateKey,
  type PeriodType,
} from "../components/PeriodToolbar";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { mediaUrl } from "../config";
import { addAmountMinor, buildProfileRegionLines } from "../lib/bidAmounts";
import {
  addDays,
  endOfDay,
  eventOccursOnDay,
  formatDayHeader,
  formatMonthYear,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "../lib/datetime";
import { resolveAppTimeZone } from "../lib/timezone";

type Tab = "overview" | "users" | "calendar" | "jobs" | "hunting" | "money";
type HuntingSubTab = "bids" | "interviews";

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
  period?: { type: PeriodType; from: string; to: string; date: string };
  interviewSchedule?: AdminInterview[];
  byUser?: Array<{
    user: { id: string; name: string; email: string; role: string; disabled: boolean };
    bids: number;
    interviews: number;
    jobs: number;
  }>;
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
    chatMessages: number;
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
  amountMinor: number | null;
  currency: string;
  appliedAt: string | null;
  updatedAt: string;
  user: Owner;
  profile?: { id: string; name: string };
};

type AdminInterview = {
  id: string;
  company: string;
  roleTitle: string;
  status: string;
  notes: string;
  scheduledAt: string | null;
  scheduleEndsAt?: string | null;
  updatedAt: string;
  user: Owner;
  profile?: { id: string; name: string };
  source?: "HUNTING" | "ICS";
  sourceType?: string;
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
    scheduleEndsAt?: string | null;
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
  chatMessages: Array<{
    id: string;
    body: string;
    createdAt: string;
    room: { id: string; name: string; slug: string };
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
const INTERVIEW_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

function formatMoney(amountMinor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "USD",
  }).format(amountMinor / 100);
}

export function AdminPage() {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const timeZone = resolveAppTimeZone(me?.timeZone);
  const { notify } = useAlerts();
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [huntings, setHuntings] = useState<AdminHunting[]>([]);
  const [interviews, setInterviews] = useState<AdminInterview[]>([]);
  const [transactions, setTransactions] = useState<AdminTx[]>([]);
  const [huntingSubTab, setHuntingSubTab] = useState<HuntingSubTab>("bids");
  const [interviewStatusFilter, setInterviewStatusFilter] = useState("ALL");
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const [anchorKey, setAnchorKey] = useState(() => toDateKey(new Date(), timeZone));
  const [filterUserId, setFilterUserId] = useState("");
  const [jobStatusFilter, setJobStatusFilter] = useState("ALL");
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");
  const [jobDetailId, setJobDetailId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<AdminJobDetail | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [calCursor, setCalCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);
  const [deleteTx, setDeleteTx] = useState<AdminTx | null>(null);
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
  const [editTxId, setEditTxId] = useState<string | null>(null);
  const [editTx, setEditTx] = useState({
    type: "EXPENSE" as "INCOME" | "EXPENSE",
    amount: "",
    currency: "USD",
    category: "",
    occurredDate: "",
    note: "",
  });
  const [createTx, setCreateTx] = useState({
    userId: "",
    type: "EXPENSE" as "INCOME" | "EXPENSE",
    amount: "",
    currency: "USD",
    category: "",
    occurredDate: toDateKey(new Date(), timeZone),
    note: "",
  });

  const periodAnchor = useMemo(() => parseDateKey(anchorKey, timeZone), [anchorKey, timeZone]);
  const rangeLabel = useMemo(
    () => periodLabel(period, periodAnchor, i18n.language, timeZone),
    [period, periodAnchor, i18n.language, timeZone],
  );

  const periodQuery = useCallback(() => {
    const params = new URLSearchParams({ period, date: anchorKey });
    if (filterUserId) params.set("userId", filterUserId);
    return params;
  }, [period, anchorKey, filterUserId]);

  const loadOverview = useCallback(async () => {
    setOverview(await api<Overview>(`/admin/overview?${periodQuery()}`));
  }, [periodQuery]);

  const loadUsers = useCallback(async () => {
    setUsers(await api<UserRow[]>("/admin/users"));
  }, []);

  const loadEvents = useCallback(async () => {
    setEvents(await api<AdminEvent[]>(`/admin/events?${periodQuery()}`));
  }, [periodQuery]);

  const loadJobs = useCallback(async () => {
    const params = periodQuery();
    if (jobStatusFilter !== "ALL") params.set("status", jobStatusFilter);
    setJobs(await api<AdminJob[]>(`/admin/jobs?${params}`));
  }, [periodQuery, jobStatusFilter]);

  const loadHuntings = useCallback(async () => {
    const params = periodQuery();
    setHuntings(await api<AdminHunting[]>(`/admin/huntings?${params}`));
  }, [periodQuery]);

  const loadInterviews = useCallback(async () => {
    const params = periodQuery();
    if (interviewStatusFilter !== "ALL") params.set("status", interviewStatusFilter);
    setInterviews(await api<AdminInterview[]>(`/admin/interviews?${params}`));
  }, [periodQuery, interviewStatusFilter]);

  const loadTransactions = useCallback(async () => {
    const params = periodQuery();
    if (txTypeFilter !== "ALL") params.set("type", txTypeFilter);
    setTransactions(await api<AdminTx[]>(`/admin/transactions?${params}`));
  }, [periodQuery, txTypeFilter]);

  useEffect(() => {
    void loadOverview().catch(() => undefined);
    void loadUsers().catch(() => undefined);
  }, [loadOverview, loadUsers]);

  useEffect(() => {
    if (tab === "calendar") void loadEvents().catch(() => undefined);
    if (tab === "jobs") void loadJobs().catch(() => undefined);
    if (tab === "hunting") {
      if (huntingSubTab === "bids") void loadHuntings().catch(() => undefined);
      else void loadInterviews().catch(() => undefined);
    }
    if (tab === "money") void loadTransactions().catch(() => undefined);
  }, [
    tab,
    huntingSubTab,
    period,
    anchorKey,
    filterUserId,
    loadEvents,
    loadJobs,
    loadHuntings,
    loadInterviews,
    loadTransactions,
  ]);

  useEffect(() => {
    if (period === "monthly") {
      setCalCursor(startOfMonth(parseDateKey(anchorKey, timeZone)));
      setSelectedDay(startOfDay(parseDateKey(anchorKey, timeZone)));
    } else if (period === "daily") {
      setSelectedDay(startOfDay(parseDateKey(anchorKey, timeZone)));
    }
  }, [period, anchorKey, timeZone]);

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

  const jobOwnerStatus = useMemo(() => {
    const list = filterUserId ? users.filter((u) => u.id === filterUserId) : users;
    return list.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      disabled: u.disabled,
      jobs: u._count.jobs,
      isJobUser: u._count.jobs > 0,
    }));
  }, [users, filterUserId]);

  const monthCells = useMemo(() => {
    const monthStart = startOfMonth(calCursor);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [calCursor]);

  const dayEvents = useMemo(
    () => events.filter((ev) => eventOccursOnDay(ev, selectedDay)),
    [events, selectedDay]
  );

  const emptyAmount = t("reports.noAmount");

  const bidAmountSummaries = useMemo(() => {
    const byUser = new Map<
      string,
      {
        userId: string;
        userName: string;
        userEmail: string;
        profiles: Map<string, { profileId: string; profileName: string; amountsByCurrency: Record<string, number> }>;
      }
    >();

    for (const bid of huntings) {
      const userRow = byUser.get(bid.user.id) ?? {
        userId: bid.user.id,
        userName: bid.user.name,
        userEmail: bid.user.email,
        profiles: new Map(),
      };
      const profileId = bid.profile?.id ?? "__none__";
      const profileRow = userRow.profiles.get(profileId) ?? {
        profileId,
        profileName: bid.profile?.name ?? "—",
        amountsByCurrency: {},
      };
      addAmountMinor(profileRow.amountsByCurrency, bid.amountMinor, bid.currency || "USD");
      userRow.profiles.set(profileId, profileRow);
      byUser.set(bid.user.id, userRow);
    }

    return [...byUser.values()]
      .map((row) => {
        const profiles = [...row.profiles.values()];
        const lines = buildProfileRegionLines(profiles, i18n.language, emptyAmount);
        return {
          userId: row.userId,
          userName: row.userName,
          userEmail: row.userEmail,
          profilesLine: lines.profilesLine,
          regionsLine: lines.regionsLine,
        };
      })
      .sort((a, b) => a.userName.localeCompare(b.userName));
  }, [huntings, i18n.language, emptyAmount]);

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
    setBusy(true);
    setError("");
    try {
      await api(`/admin/users/${u.id}`, { method: "DELETE" });
      if (editId === u.id) setEditId(null);
      if (detailUserId === u.id) setDetailUserId(null);
      setDeleteUser(null);
      await Promise.all([loadUsers(), loadOverview()]);
      notify({
        title: t("admin.toastDeletedTitle"),
        body: t("admin.toastDeletedBody", { name: u.name }),
        tone: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  function startEditTx(tx: AdminTx) {
    setEditTxId(tx.id);
    setEditTx({
      type: tx.type,
      amount: (tx.amountMinor / 100).toFixed(2),
      currency: tx.currency || "USD",
      category: tx.category,
      occurredDate: toDateKey(new Date(tx.occurredAt), timeZone),
      note: tx.note || "",
    });
    setError("");
  }

  async function onCreateTx(e: FormEvent) {
    e.preventDefault();
    const userId = createTx.userId || filterUserId;
    if (!userId) {
      setError(t("admin.selectUserRequired"));
      return;
    }
    const amountMinor = Math.round(Number(createTx.amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor < 1) {
      setError(t("common.error"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/transactions", {
        method: "POST",
        body: JSON.stringify({
          userId,
          type: createTx.type,
          amountMinor,
          currency: createTx.currency.trim().toUpperCase() || "USD",
          category: createTx.category.trim(),
          occurredAt: parseDateKey(createTx.occurredDate, timeZone).toISOString(),
          note: createTx.note.trim(),
        }),
      });
      setCreateTx((c) => ({
        ...c,
        amount: "",
        category: "",
        note: "",
        occurredDate: toDateKey(new Date(), timeZone),
      }));
      await loadTransactions();
      notify({
        title: t("money.toastCreatedTitle"),
        body: t("money.toastCreatedBody", {
          amount: formatMoney(amountMinor, createTx.currency || "USD", i18n.language),
          category: createTx.category.trim(),
        }),
        tone: "success",
        sourceType: "TRANSACTION",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEditTx(e: FormEvent) {
    e.preventDefault();
    if (!editTxId) return;
    const amountMinor = Math.round(Number(editTx.amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor < 1) {
      setError(t("common.error"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const occurredAt = parseDateKey(editTx.occurredDate, timeZone).toISOString();
      await api(`/transactions/${editTxId}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: editTx.type,
          amountMinor,
          currency: editTx.currency.trim().toUpperCase() || "USD",
          category: editTx.category.trim(),
          occurredAt,
          note: editTx.note.trim(),
        }),
      });
      setEditTxId(null);
      await loadTransactions();
      notify({
        title: t("money.toastUpdatedTitle"),
        body: t("money.toastUpdatedBody", {
          amount: formatMoney(amountMinor, editTx.currency || "USD", i18n.language),
          category: editTx.category.trim(),
        }),
        tone: "success",
        sourceType: "TRANSACTION",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteTx(tx: AdminTx) {
    setBusy(true);
    setError("");
    try {
      await api(`/transactions/${tx.id}`, { method: "DELETE" });
      if (editTxId === tx.id) setEditTxId(null);
      setDeleteTx(null);
      await loadTransactions();
      notify({
        title: t("money.toastDeletedTitle"),
        body: t("money.toastDeletedBody", {
          amount: formatMoney(tx.amountMinor, tx.currency, i18n.language),
          category: tx.category,
        }),
        tone: "success",
        sourceType: "TRANSACTION",
      });
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

  const periodControls = (
    <PeriodToolbar
      period={period}
      anchorKey={anchorKey}
      onPeriodChange={setPeriod}
      onAnchorKeyChange={setAnchorKey}
      labelKey="admin.periodLabel"
      timeZone={timeZone}
    />
  );

  return (
    <section className="page admin-page">
      <PageHeader title={t("admin.heading")} />

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

      {error && (
        <AlertBanner tone="danger" onDismiss={() => setError("")}>
          {error}
        </AlertBanner>
      )}

      {tab === "overview" && (
        <div className="stack admin-overview">
          <div className="admin-events-toolbar">
            <label className="field admin-period-user">
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
          {periodControls}

          <div className="admin-metrics">
            {(
              [
                ["users", overview?.users],
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

          <div className="admin-breakdown-grid admin-breakdown-grid-3">
            <article className="panel">
              <h2>{t("admin.jobsByStatus")}</h2>
              <div className="admin-status-list">
                {JOB_STATUSES.map((s) => (
                  <div key={s} className="admin-status-row">
                    <StatusBadge tone={statusTone(s)}>
                      {t(`jobs.status.${s}`, { defaultValue: s })}
                    </StatusBadge>
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
                    <StatusBadge tone={statusTone(s)}>
                      {t(`hunting.bids.status.${s}`, { defaultValue: s })}
                    </StatusBadge>
                    <strong className="tabular">
                      {overview?.bidsByStatus?.[s] ?? overview?.huntingsByStage?.[s] ?? 0}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
            <article className="panel">
              <h2>{t("admin.interviewsByStatus")}</h2>
              <div className="admin-status-list">
                {INTERVIEW_STATUSES.map((s) => (
                  <div key={s} className="admin-status-row">
                    <StatusBadge tone={statusTone(s)}>
                      {t(`hunting.interviews.status.${s}`, { defaultValue: s })}
                    </StatusBadge>
                    <strong className="tabular">{overview?.interviewsByStatus?.[s] ?? 0}</strong>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <article className="panel">
            <h2>{t("admin.interviewSchedule")}</h2>
            {(overview?.interviewSchedule?.length ?? 0) === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t("common.company")}</th>
                      <th>{t("common.role")}</th>
                      <th>{t("admin.owner")}</th>
                      <th>{t("common.status")}</th>
                      <th>{t("admin.scheduledAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview?.interviewSchedule?.map((iv) => (
                      <tr key={iv.id}>
                        <td>
                          <strong>{iv.company}</strong>
                          {iv.profile?.name && (
                            <p className="muted small">{iv.profile.name}</p>
                          )}
                        </td>
                        <td>{iv.roleTitle}</td>
                        <td>
                          {iv.user.name}
                          <p className="muted small">{iv.user.email}</p>
                        </td>
                        <td>
                          <StatusBadge tone={statusTone(iv.status)}>
                            {t(`hunting.interviews.status.${iv.status}`, {
                              defaultValue: iv.status,
                            })}
                          </StatusBadge>
                        </td>
                        <td className="tabular">
                          {iv.scheduledAt ? fmt(iv.scheduledAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="panel">
            <h2>{t("admin.byUser")}</h2>
            {(overview?.byUser?.length ?? 0) === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t("admin.owner")}</th>
                      <th className="tabular">{t("admin.metric.jobs")}</th>
                      <th className="tabular">{t("admin.metric.huntings")}</th>
                      <th className="tabular">{t("admin.metric.interviews")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {overview?.byUser?.map((row) => (
                      <tr key={row.user.id}>
                        <td>
                          <strong>{row.user.name}</strong>
                          <p className="muted small">{row.user.email}</p>
                        </td>
                        <td className="tabular">{row.jobs}</td>
                        <td className="tabular">{row.bids}</td>
                        <td className="tabular">{row.interviews}</td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setDetailUserId(row.user.id);
                              setTab("users");
                            }}
                          >
                            {t("admin.view")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
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
              <PasswordField
                label={t("auth.password")}
                value={create.password}
                onChange={(e) => setCreate((c) => ({ ...c, password: e.target.value }))}
                autoComplete="new-password"
                minLength={6}
                required
              />
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
                    onClick={() => setDeleteUser(u)}
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
                    <PasswordField
                      label={t("admin.newPassword")}
                      value={edit.password}
                      onChange={(e) => setEdit((x) => ({ ...x, password: e.target.value }))}
                      placeholder={t("admin.passwordOptional")}
                      autoComplete="new-password"
                      minLength={6}
                    />
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
                        <StatusBadge tone={statusTone(j.status)}>
                          {t(`jobs.status.${j.status}`, { defaultValue: j.status })}
                        </StatusBadge>
                        <StatusBadge tone={statusTone(j.priority)}>
                          {t(`jobs.priority.${j.priority}`, { defaultValue: j.priority })}
                        </StatusBadge>
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
                                <StatusBadge tone={statusTone(it.status)}>
                                  {t(`jobs.daily.itemStatus.${it.status}`, { defaultValue: it.status })}
                                </StatusBadge>{" "}
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
                      <StatusBadge tone={statusTone(h.status)}>
                        {t(`hunting.bids.status.${h.status}`, { defaultValue: h.status })}
                      </StatusBadge>
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
                          {h.scheduledAt ? fmt(h.scheduledAt) : t("admin.unscheduled")}
                          {h.notes ? ` · ${h.notes}` : ""}
                        </p>
                      </div>
                      <StatusBadge tone={statusTone(h.status)}>
                        {t(`hunting.interviews.status.${h.status}`, { defaultValue: h.status })}
                      </StatusBadge>
                    </article>
                  ))}
                </div>
              </article>

              <article className="panel">
                <h3>{t("admin.sectionMoney")}</h3>
                {userDetail.transactions.length === 0 && (
                  <p className="muted">{t("common.empty")}</p>
                )}
                {userDetail.transactions.length > 0 && (
                  <MoneyCharts
                    transactions={userDetail.transactions}
                    locale={i18n.language}
                    filterUserId={userDetail.id}
                    compact
                  />
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
                {userDetail.chatMessages.length === 0 && userDetail.discussions.length === 0 && (
                  <p className="muted">{t("common.empty")}</p>
                )}
                <div className="list">
                  {userDetail.chatMessages.map((m) => (
                    <div key={m.id} className="admin-detail-block">
                      <strong>{m.room.name}</strong>
                      <p className="muted small">
                        {fmt(m.createdAt)}: {m.body}
                      </p>
                    </div>
                  ))}
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
          {periodControls}
          <div className="admin-events-toolbar">
            <button type="button" className="btn" onClick={() => void loadEvents()}>
              {t("admin.refresh")}
            </button>
          </div>

          {period === "monthly" ? (
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
          ) : (
            <div className="panel">
              <h3>{rangeLabel}</h3>
              {events.length === 0 && <p className="muted">{t("admin.noEvents")}</p>}
              <div className="list">
                {events.map((ev) => (
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
            </div>
          )}
        </div>
      )}

      {tab === "jobs" && (
        <div className="admin-jobs">
          {filterBar}
          {periodControls}
          <div className="admin-events-toolbar">
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

          <article className="panel admin-job-owner-status">
            <h2>{t("admin.jobOwnerStatus")}</h2>
            {jobOwnerStatus.length === 0 ? (
              <p className="muted">{t("common.empty")}</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t("admin.owner")}</th>
                      <th>{t("admin.jobOwnerStatusCol")}</th>
                      <th className="tabular">{t("admin.metric.jobs")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {jobOwnerStatus.map((u) => (
                      <tr key={u.id} className={u.disabled ? "disabled" : undefined}>
                        <td>
                          <span>{u.name}</span>
                          <p className="muted small">{u.email}</p>
                        </td>
                        <td>
                          {u.isJobUser ? (
                            <StatusBadge tone="success">{t("admin.jobOwnerHasJobs")}</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">{t("admin.jobOwnerJobless")}</StatusBadge>
                          )}
                        </td>
                        <td className="tabular">{u.jobs}</td>
                        <td>
                          {!filterUserId && (
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => setFilterUserId(u.id)}
                            >
                              {t("admin.view")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          {jobs.length === 0 && <p className="muted">{t("common.empty")}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("common.title")}</th>
                  <th>{t("admin.description")}</th>
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
                    </td>
                    <td className="muted small admin-desc-cell">
                      {j.description?.trim() ? j.description : "—"}
                    </td>
                    <td>
                      <span>{j.user.name}</span>
                      <p className="muted small">{j.user.email}</p>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(j.status)}>
                        {t(`jobs.status.${j.status}`, { defaultValue: j.status })}
                      </StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(j.priority)}>
                        {t(`jobs.priority.${j.priority}`, { defaultValue: j.priority })}
                      </StatusBadge>
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
                <StatusBadge tone={statusTone(jobDetail.status)}>
                  {t(`jobs.status.${jobDetail.status}`, { defaultValue: jobDetail.status })}
                </StatusBadge>
                <StatusBadge tone={statusTone(jobDetail.priority)}>
                  {t(`jobs.priority.${jobDetail.priority}`, { defaultValue: jobDetail.priority })}
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
                        <StatusBadge tone={statusTone(it.status)}>
                          {t(`jobs.daily.itemStatus.${it.status}`, { defaultValue: it.status })}
                        </StatusBadge>{" "}
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
            <div className="cal-views" role="group" aria-label={t("admin.tabHunting")}>
              <button
                type="button"
                className={`btn${huntingSubTab === "bids" ? " primary" : " ghost"}`}
                onClick={() => setHuntingSubTab("bids")}
              >
                {t("admin.subBids")}
              </button>
              <button
                type="button"
                className={`btn${huntingSubTab === "interviews" ? " primary" : " ghost"}`}
                onClick={() => setHuntingSubTab("interviews")}
              >
                {t("admin.subInterviews")}
              </button>
            </div>
            {huntingSubTab === "interviews" && (
              <label className="field">
                <span>{t("common.status")}</span>
                <select
                  value={interviewStatusFilter}
                  onChange={(e) => setInterviewStatusFilter(e.target.value)}
                >
                  <option value="ALL">{t("admin.allStatuses")}</option>
                  {INTERVIEW_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`hunting.interviews.status.${s}`, { defaultValue: s })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="cal-views" role="group" aria-label={t("admin.periodLabel")}>
              {PERIODS.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`btn${period === mode ? " primary" : " ghost"}`}
                  onClick={() => setPeriod(mode)}
                >
                  {t(`reports.period.${mode}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void (huntingSubTab === "bids" ? loadHuntings() : loadInterviews())
              }
            >
              {t("admin.refresh")}
            </button>
          </div>

          {periodControls}

          {huntingSubTab === "bids" && (
            <>
              {huntings.length === 0 ? (
                <p className="muted">{t("common.empty")}</p>
              ) : (
                <article className="panel admin-bid-amounts">
                  <h3>{t("admin.bidTotalsByUser")}</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>{t("admin.owner")}</th>
                          <th>{t("admin.bidAmountsByProfile")}</th>
                          <th>{t("admin.bidAmountsByRegion")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bidAmountSummaries.map((row) => (
                          <tr key={row.userId}>
                            <td>
                              <strong>{row.userName}</strong>
                              <p className="muted small">{row.userEmail}</p>
                            </td>
                            <td className="tabular admin-bid-breakdown" translate="no">
                              {row.profilesLine}
                            </td>
                            <td className="tabular admin-bid-breakdown" translate="no">
                              {row.regionsLine}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}
            </>
          )}

          {huntingSubTab === "interviews" && (
            <>
              {interviews.length === 0 && <p className="muted">{t("common.empty")}</p>}
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t("common.company")}</th>
                      <th>{t("common.role")}</th>
                      <th>{t("hunting.profile.label")}</th>
                      <th>{t("admin.owner")}</th>
                      <th>{t("common.status")}</th>
                      <th>{t("admin.scheduledAt")}</th>
                      <th>{t("common.notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interviews.map((iv) => (
                      <tr key={iv.id}>
                        <td>
                          <strong>{iv.company}</strong>
                        </td>
                        <td>{iv.roleTitle}</td>
                        <td>{iv.profile?.name ?? "—"}</td>
                        <td>
                          {iv.user.name}
                          <p className="muted small">{iv.user.email}</p>
                        </td>
                        <td>
                          <StatusBadge tone={statusTone(iv.status)}>
                            {t(`hunting.interviews.status.${iv.status}`, {
                              defaultValue: iv.status,
                            })}
                          </StatusBadge>
                        </td>
                        <td className="tabular">
                          {iv.scheduledAt ? fmt(iv.scheduledAt) : "—"}
                        </td>
                        <td className="muted small">
                          {iv.source === "ICS" ? "—" : iv.notes || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "money" && (
        <div className="admin-money">
          {filterBar}
          {periodControls}
          <div className="admin-events-toolbar">
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

          <article className="panel">
            <h2>{t("money.new")}</h2>
            <form className="admin-edit-form stack" onSubmit={(e) => void onCreateTx(e)}>
              <div className="admin-inline-fields">
                <label className="field">
                  <span>{t("admin.owner")}</span>
                  <select
                    value={createTx.userId || filterUserId}
                    onChange={(e) => setCreateTx((c) => ({ ...c, userId: e.target.value }))}
                    required
                  >
                    <option value="">{t("admin.selectUser")}</option>
                    {userOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("common.type")}</span>
                  <select
                    value={createTx.type}
                    onChange={(e) =>
                      setCreateTx((c) => ({
                        ...c,
                        type: e.target.value as "INCOME" | "EXPENSE",
                      }))
                    }
                  >
                    <option value="INCOME">{t("common.income")}</option>
                    <option value="EXPENSE">{t("common.expense")}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("common.amount")}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    value={createTx.amount}
                    onChange={(e) => setCreateTx((c) => ({ ...c, amount: e.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("money.currency")}</span>
                  <input
                    value={createTx.currency}
                    onChange={(e) => setCreateTx((c) => ({ ...c, currency: e.target.value }))}
                    maxLength={3}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("common.category")}</span>
                  <input
                    value={createTx.category}
                    onChange={(e) => setCreateTx((c) => ({ ...c, category: e.target.value }))}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("admin.occurred")}</span>
                  <input
                    type="date"
                    value={createTx.occurredDate}
                    onChange={(e) =>
                      setCreateTx((c) => ({ ...c, occurredDate: e.target.value }))
                    }
                    required
                  />
                </label>
              </div>
              <label className="field">
                <span>{t("common.notes")}</span>
                <input
                  value={createTx.note}
                  onChange={(e) => setCreateTx((c) => ({ ...c, note: e.target.value }))}
                />
              </label>
              <div className="admin-user-actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {t("money.new")}
                </button>
              </div>
            </form>
          </article>

          {transactions.length === 0 && <p className="muted">{t("common.empty")}</p>}
          {transactions.length > 0 && (
            <MoneyCharts
              transactions={transactions}
              locale={i18n.language}
              filterUserId={filterUserId || undefined}
              onSelectUser={(userId) => setFilterUserId(userId)}
            />
          )}
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
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <Fragment key={tx.id}>
                    <tr>
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
                      <td>
                        <div className="admin-user-actions">
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() =>
                              editTxId === tx.id ? setEditTxId(null) : startEditTx(tx)
                            }
                          >
                            {editTxId === tx.id ? t("common.cancel") : t("common.edit")}
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={busy}
                            onClick={() => setDeleteTx(tx)}
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editTxId === tx.id && (
                      <tr>
                        <td colSpan={7}>
                          <form
                            className="admin-edit-form stack"
                            onSubmit={(e) => void onSaveEditTx(e)}
                          >
                            <div className="admin-inline-fields">
                              <label className="field">
                                <span>{t("common.type")}</span>
                                <select
                                  value={editTx.type}
                                  onChange={(e) =>
                                    setEditTx((x) => ({
                                      ...x,
                                      type: e.target.value as "INCOME" | "EXPENSE",
                                    }))
                                  }
                                >
                                  <option value="INCOME">{t("common.income")}</option>
                                  <option value="EXPENSE">{t("common.expense")}</option>
                                </select>
                              </label>
                              <label className="field">
                                <span>{t("common.amount")}</span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0.01"
                                  value={editTx.amount}
                                  onChange={(e) =>
                                    setEditTx((x) => ({ ...x, amount: e.target.value }))
                                  }
                                  required
                                />
                              </label>
                              <label className="field">
                                <span>{t("money.currency")}</span>
                                <input
                                  value={editTx.currency}
                                  onChange={(e) =>
                                    setEditTx((x) => ({ ...x, currency: e.target.value }))
                                  }
                                  maxLength={3}
                                  required
                                />
                              </label>
                              <label className="field">
                                <span>{t("common.category")}</span>
                                <input
                                  value={editTx.category}
                                  onChange={(e) =>
                                    setEditTx((x) => ({ ...x, category: e.target.value }))
                                  }
                                  required
                                />
                              </label>
                              <label className="field">
                                <span>{t("admin.occurred")}</span>
                                <input
                                  type="date"
                                  value={editTx.occurredDate}
                                  onChange={(e) =>
                                    setEditTx((x) => ({ ...x, occurredDate: e.target.value }))
                                  }
                                  required
                                />
                              </label>
                            </div>
                            <label className="field">
                              <span>{t("common.notes")}</span>
                              <input
                                value={editTx.note}
                                onChange={(e) =>
                                  setEditTx((x) => ({ ...x, note: e.target.value }))
                                }
                              />
                            </label>
                            <div className="admin-user-actions">
                              <button type="submit" className="btn primary" disabled={busy}>
                                {t("common.save")}
                              </button>
                              <button
                                type="button"
                                className="btn ghost"
                                disabled={busy}
                                onClick={() => setEditTxId(null)}
                              >
                                {t("common.cancel")}
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteUser != null}
        title={t("admin.deleteTitle")}
        body={deleteUser ? t("admin.confirmDelete", { name: deleteUser.name }) : undefined}
        danger
        busy={busy}
        onConfirm={() => {
          if (deleteUser) void onDelete(deleteUser);
        }}
        onCancel={() => {
          if (!busy) setDeleteUser(null);
        }}
      />

      <ConfirmDialog
        open={deleteTx != null}
        title={t("money.deleteTitle")}
        body={
          deleteTx
            ? t("money.confirmDelete", {
                amount: formatMoney(deleteTx.amountMinor, deleteTx.currency, i18n.language),
                category: deleteTx.category,
              })
            : t("money.confirmDeleteGeneric")
        }
        danger
        busy={busy}
        onConfirm={() => {
          if (deleteTx) void onDeleteTx(deleteTx);
        }}
        onCancel={() => {
          if (!busy) setDeleteTx(null);
        }}
      />
    </section>
  );
}
