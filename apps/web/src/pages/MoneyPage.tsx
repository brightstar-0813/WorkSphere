import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";

type Tx = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amountMinor: number;
  currency: string;
  category: string;
  occurredAt: string;
  note: string;
};

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

export function MoneyPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Tx[]>([]);
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");

  async function load() {
    setItems(await api<Tx[]>("/transactions"));
  }

  useEffect(() => {
    void load();
  }, []);

  const net = useMemo(() => {
    let n = 0;
    for (const tx of items) {
      n += tx.type === "INCOME" ? tx.amountMinor : -tx.amountMinor;
    }
    return n;
  }, [items]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const amountMinor = Math.round(Number(amount) * 100);
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
    await load();
  }

  async function remove(id: string) {
    await api(`/transactions/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className="page">
      <h1>{t("money.heading")}</h1>
      <p className="stat">
        {t("money.net")}: <strong>{formatMoney(net, items[0]?.currency ?? "USD")}</strong>
      </p>
      <form className="toolbar" onSubmit={onAdd}>
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
            placeholder={`${t("common.amount")}…`}
            aria-label={t("common.amount")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <input
            name="category"
            autoComplete="off"
            placeholder={`${t("common.category")}…`}
            aria-label={t("common.category")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          />
        </div>
        <button className="btn primary">{t("money.new")}</button>
      </form>
      <div className="list">
        {items.length === 0 && <p className="muted">{t("common.empty")}</p>}
        {items.map((tx) => (
          <article key={tx.id} className="row">
            <div>
              <strong className={tx.type === "INCOME" ? "pos" : "neg"}>
                {tx.type === "INCOME" ? "+" : "-"}
                {formatMoney(tx.amountMinor, tx.currency)}
              </strong>
              <p className="muted">
                {tx.category} · {new Date(tx.occurredAt).toLocaleDateString()}
              </p>
            </div>
            <button className="btn ghost" onClick={() => void remove(tx.id)}>
              {t("common.delete")}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
