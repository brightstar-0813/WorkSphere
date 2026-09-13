import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiList, type ListMeta } from "../api";
import { useAuth } from "../auth";
import { useAlerts } from "../alerts/AlertProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { PageState } from "../components/PageState";
import { Pagination } from "../components/Pagination";
import { RowSelectCheckbox } from "../components/RowSelectCheckbox";
import { SelectionBar } from "../components/SelectionBar";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { parseDateKey, toDateKey } from "../components/PeriodToolbar";
import { useRowSelection } from "../hooks/useRowSelection";
import { resolveAppTimeZone } from "../lib/timezone";

type Tx = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amountMinor: number;
  currency: string;
  category: string;
  occurredAt: string;
  note: string;
};

type EditForm = {
  type: "INCOME" | "EXPENSE";
  amount: string;
  currency: string;
  category: string;
  occurredDate: string;
  note: string;
};

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

export function MoneyPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useAlerts();
  const timeZone = resolveAppTimeZone(user?.timeZone);
  const [items, setItems] = useState<Tx[]>([]);
  const [meta, setMeta] = useState<ListMeta>({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditForm>({
    type: "EXPENSE",
    amount: "",
    currency: "USD",
    category: "",
    occurredDate: toDateKey(new Date(), timeZone),
    note: "",
  });
  const [busy, setBusy] = useState(false);

  async function load(nextPage = page) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: "10",
      });
      const { data, meta: listMeta } = await apiList<Tx[]>(`/transactions?${params}`);
      setItems(data);
      setMeta(listMeta);
      setPage(listMeta.page);
    } catch (err) {
      notify({
        title: t("common.error"),
        body: err instanceof Error ? err.message : undefined,
        tone: "danger",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, []);

  const net = useMemo(() => {
    let n = 0;
    for (const tx of items) {
      n += tx.type === "INCOME" ? tx.amountMinor : -tx.amountMinor;
    }
    return n;
  }, [items]);

  const currency = items[0]?.currency ?? "USD";
  const pendingDelete = items.find((tx) => tx.id === deleteId) ?? null;
  const pageIds = useMemo(() => items.map((tx) => tx.id), [items]);
  const selection = useRowSelection(pageIds);

  function startEdit(tx: Tx) {
    setEditId(tx.id);
    setEdit({
      type: tx.type,
      amount: (tx.amountMinor / 100).toFixed(2),
      currency: tx.currency || "USD",
      category: tx.category,
      occurredDate: toDateKey(new Date(tx.occurredAt), timeZone),
      note: tx.note || "",
    });
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const amountMinor = Math.round(Number(amount) * 100);
    setBusy(true);
    try {
      await api("/transactions", {
        method: "POST",
        body: JSON.stringify({
          type,
          amountMinor,
          category,
          occurredAt: new Date().toISOString(),
        }),
      });
      setAmount("");
      setCategory("");
      await load(1);
      notify({
        title: t("money.toastCreatedTitle"),
        body: t("money.toastCreatedBody", {
          amount: formatMoney(amountMinor, currency),
          category,
        }),
        tone: "success",
        sourceType: "TRANSACTION",
      });
    } catch (err) {
      notify({
        title: t("common.error"),
        body: err instanceof Error ? err.message : undefined,
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editId) return;
    const amountMinor = Math.round(Number(edit.amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor < 1) {
      notify({ title: t("common.error"), tone: "danger" });
      return;
    }
    setBusy(true);
    try {
      await api(`/transactions/${editId}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: edit.type,
          amountMinor,
          currency: edit.currency.trim().toUpperCase() || "USD",
          category: edit.category.trim(),
          occurredAt: parseDateKey(edit.occurredDate, timeZone).toISOString(),
          note: edit.note.trim(),
        }),
      });
      setEditId(null);
      await load(page);
      notify({
        title: t("money.toastUpdatedTitle"),
        body: t("money.toastUpdatedBody", {
          amount: formatMoney(amountMinor, edit.currency || "USD"),
          category: edit.category.trim(),
        }),
        tone: "success",
        sourceType: "TRANSACTION",
      });
    } catch (err) {
      notify({
        title: t("common.error"),
        body: err instanceof Error ? err.message : undefined,
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const tx = items.find((x) => x.id === id);
    setBusy(true);
    try {
      await api(`/transactions/${id}`, { method: "DELETE" });
      if (editId === id) setEditId(null);
      setDeleteId(null);
      selection.clear();
      const nextPage = items.length <= 1 && page > 1 ? page - 1 : page;
      await load(nextPage);
      notify({
        title: t("money.toastDeletedTitle"),
        body: tx
          ? t("money.toastDeletedBody", {
              amount: formatMoney(tx.amountMinor, tx.currency),
              category: tx.category,
            })
          : undefined,
        tone: "success",
        sourceType: "TRANSACTION",
      });
    } catch (err) {
      notify({
        title: t("common.error"),
        body: err instanceof Error ? err.message : undefined,
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => api(`/transactions/${id}`, { method: "DELETE" })));
      if (editId && ids.includes(editId)) setEditId(null);
      setConfirmBulkDelete(false);
      selection.clear();
      const remaining = items.length - ids.length;
      const nextPage = remaining <= 0 && page > 1 ? page - 1 : page;
      await load(nextPage);
      notify({
        title: t("money.toastDeletedTitle"),
        body: t("common.selectedCount", { count: ids.length }),
        tone: "success",
        sourceType: "TRANSACTION",
      });
    } catch (err) {
      notify({
        title: t("common.error"),
        body: err instanceof Error ? err.message : undefined,
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page money-page">
      <PageHeader title={t("money.heading")} subtitle={t("money.subtitle")} />

      <div className="itsm-metrics money-kpi" role="group" aria-label={t("money.net")}>
        <article className="itsm-metric">
          <span className="muted small">{t("money.net")}</span>
          <strong className="tabular">{formatMoney(net, currency)}</strong>
          <span className="muted small">{t("money.pageNetHint")}</span>
        </article>
        <article className="itsm-metric">
          <span className="muted small">{t("common.pagination")}</span>
          <strong className="tabular">{meta.total}</strong>
          <span className="muted small">{t("money.totalHint")}</span>
        </article>
      </div>

      <form className="toolbar panel money-add-form" onSubmit={(e) => void onAdd(e)}>
        <div className="field-group" role="group" aria-label={t("money.new")}>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as "INCOME" | "EXPENSE")}
            aria-label={t("common.type")}
          >
            <option value="INCOME">{t("common.income")}</option>
            <option value="EXPENSE">{t("common.expense")}</option>
          </select>
          <input
            type="number"
            name="amount"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            autoComplete="off"
            placeholder={t("money.amountPlaceholder")}
            aria-label={t("common.amount")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <input
            name="category"
            autoComplete="off"
            placeholder={t("money.categoryPlaceholder")}
            aria-label={t("common.category")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          />
        </div>
        <button className="btn primary" disabled={busy || loading}>
          {t("money.new")}
        </button>
      </form>

      <div className="panel money-list-panel">
        <PageState loading={loading && items.length === 0} empty={!loading && items.length === 0} />
        {items.length > 0 ? (
          <SelectionBar
            selection={selection}
            pageIds={pageIds}
            disabled={loading}
            deleteBusy={busy}
            onDeleteSelected={() => setConfirmBulkDelete(true)}
          />
        ) : null}
        <div className="list">
          {items.map((tx) => (
            <article
              key={tx.id}
              className={`row money-tx-row${editId === tx.id ? " is-editing" : ""}${
                selection.isSelected(tx.id) ? " is-selected" : ""
              }`}
            >
              <div className="money-tx-main">
                <RowSelectCheckbox
                  checked={selection.isSelected(tx.id)}
                  onChange={() => selection.toggle(tx.id)}
                  label={t("common.selectRow")}
                  disabled={busy || loading}
                />
                <div>
                  <strong className={tx.type === "INCOME" ? "pos" : "neg"}>
                    {tx.type === "INCOME" ? "+" : "-"}
                    {formatMoney(tx.amountMinor, tx.currency)}
                  </strong>
                  <p className="muted">
                    <StatusBadge tone={tx.type === "INCOME" ? "success" : statusTone("EXPENSE")}>
                      {tx.type === "INCOME" ? t("common.income") : t("common.expense")}
                    </StatusBadge>{" "}
                    {tx.category} · {new Date(tx.occurredAt).toLocaleDateString()}
                    {tx.note ? ` · ${tx.note}` : ""}
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => (editId === tx.id ? setEditId(null) : startEdit(tx))}
                  >
                    {editId === tx.id ? t("common.cancel") : t("common.edit")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setDeleteId(tx.id)}
                    disabled={busy}
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>

              {editId === tx.id && (
                <form className="money-edit-form stack" onSubmit={(e) => void onSaveEdit(e)}>
                  <div className="field-group money-edit-fields">
                    <label className="field">
                      <span>{t("common.type")}</span>
                      <select
                        value={edit.type}
                        onChange={(e) =>
                          setEdit((x) => ({ ...x, type: e.target.value as "INCOME" | "EXPENSE" }))
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
                        value={edit.amount}
                        onChange={(e) => setEdit((x) => ({ ...x, amount: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("money.currency")}</span>
                      <input
                        value={edit.currency}
                        onChange={(e) => setEdit((x) => ({ ...x, currency: e.target.value }))}
                        maxLength={3}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("common.category")}</span>
                      <input
                        value={edit.category}
                        onChange={(e) => setEdit((x) => ({ ...x, category: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("money.occurred")}</span>
                      <input
                        type="date"
                        value={edit.occurredDate}
                        onChange={(e) => setEdit((x) => ({ ...x, occurredDate: e.target.value }))}
                        required
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>{t("common.notes")}</span>
                    <input
                      value={edit.note}
                      onChange={(e) => setEdit((x) => ({ ...x, note: e.target.value }))}
                    />
                  </label>
                  <div className="row-actions">
                    <button type="submit" className="btn primary" disabled={busy}>
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => setEditId(null)}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </div>
        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          pageSize={meta.pageSize}
          disabled={loading || busy}
          onPageChange={(p) => void load(p)}
        />
      </div>

      <ConfirmDialog
        open={deleteId != null}
        title={t("money.deleteTitle")}
        body={
          pendingDelete
            ? t("money.confirmDelete", {
                amount: formatMoney(pendingDelete.amountMinor, pendingDelete.currency),
                category: pendingDelete.category,
              })
            : t("money.confirmDeleteGeneric")
        }
        danger
        busy={busy}
        onConfirm={() => {
          if (deleteId) void remove(deleteId);
        }}
        onCancel={() => {
          if (!busy) setDeleteId(null);
        }}
      />

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
    </section>
  );
}
