import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type MoneyTx = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amountMinor: number;
  currency: string;
  category: string;
  occurredAt: string;
  user?: { id: string; name: string; email: string };
};

type UserBucket = {
  userId: string;
  name: string;
  email: string;
  incomeMinor: number;
  expenseMinor: number;
  currency: string;
  count: number;
};

type MonthBucket = {
  key: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
};

type CategoryBucket = {
  category: string;
  incomeMinor: number;
  expenseMinor: number;
};

function formatMoney(amountMinor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "USD",
  }).format(amountMinor / 100);
}

function dominantCurrency(txs: MoneyTx[]) {
  const counts = new Map<string, number>();
  for (const tx of txs) {
    counts.set(tx.currency, (counts.get(tx.currency) ?? 0) + 1);
  }
  let best = "USD";
  let n = 0;
  for (const [c, count] of counts) {
    if (count > n) {
      best = c;
      n = count;
    }
  }
  return best;
}

function aggregateByUser(txs: MoneyTx[]): UserBucket[] {
  const map = new Map<string, UserBucket & { currencyCounts: Map<string, number> }>();
  for (const tx of txs) {
    const userId = tx.user?.id ?? "unknown";
    const existing = map.get(userId);
    if (!existing) {
      const currencyCounts = new Map<string, number>([[tx.currency, 1]]);
      map.set(userId, {
        userId,
        name: tx.user?.name ?? "—",
        email: tx.user?.email ?? "",
        incomeMinor: tx.type === "INCOME" ? tx.amountMinor : 0,
        expenseMinor: tx.type === "EXPENSE" ? tx.amountMinor : 0,
        currency: tx.currency,
        count: 1,
        currencyCounts,
      });
      continue;
    }
    if (tx.type === "INCOME") existing.incomeMinor += tx.amountMinor;
    else existing.expenseMinor += tx.amountMinor;
    existing.count += 1;
    existing.currencyCounts.set(
      tx.currency,
      (existing.currencyCounts.get(tx.currency) ?? 0) + 1
    );
  }
  return [...map.values()]
    .map(({ currencyCounts, ...row }) => {
      let currency = row.currency;
      let max = 0;
      for (const [c, n] of currencyCounts) {
        if (n > max) {
          currency = c;
          max = n;
        }
      }
      return { ...row, currency };
    })
    .sort((a, b) => b.incomeMinor + b.expenseMinor - (a.incomeMinor + a.expenseMinor));
}

function aggregateByMonth(txs: MoneyTx[], locale: string, months = 6): MonthBucket[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const map = new Map(keys.map((key) => [key, { incomeMinor: 0, expenseMinor: 0 }]));
  for (const tx of txs) {
    const d = new Date(tx.occurredAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = map.get(key);
    if (!bucket) continue;
    if (tx.type === "INCOME") bucket.incomeMinor += tx.amountMinor;
    else bucket.expenseMinor += tx.amountMinor;
  }
  return keys.map((key) => {
    const [y, m] = key.split("-").map(Number);
    const label = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(
      new Date(y, m - 1, 1)
    );
    const bucket = map.get(key)!;
    return { key, label, ...bucket };
  });
}

function aggregateByCategory(txs: MoneyTx[]): CategoryBucket[] {
  const map = new Map<string, CategoryBucket>();
  for (const tx of txs) {
    const existing = map.get(tx.category);
    if (!existing) {
      map.set(tx.category, {
        category: tx.category,
        incomeMinor: tx.type === "INCOME" ? tx.amountMinor : 0,
        expenseMinor: tx.type === "EXPENSE" ? tx.amountMinor : 0,
      });
      continue;
    }
    if (tx.type === "INCOME") existing.incomeMinor += tx.amountMinor;
    else existing.expenseMinor += tx.amountMinor;
  }
  return [...map.values()].sort(
    (a, b) => b.incomeMinor + b.expenseMinor - (a.incomeMinor + a.expenseMinor)
  );
}

function DualBar({
  income,
  expense,
  max,
}: {
  income: number;
  expense: number;
  max: number;
}) {
  const incomePct = max > 0 ? Math.max((income / max) * 100, income > 0 ? 2 : 0) : 0;
  const expensePct = max > 0 ? Math.max((expense / max) * 100, expense > 0 ? 2 : 0) : 0;
  return (
    <div className="money-dual-bar" aria-hidden>
      <div className="money-dual-track">
        <span className="money-dual-fill income" style={{ width: `${incomePct}%` }} />
      </div>
      <div className="money-dual-track">
        <span className="money-dual-fill expense" style={{ width: `${expensePct}%` }} />
      </div>
    </div>
  );
}

type Props = {
  transactions: MoneyTx[];
  locale: string;
  /** When set, highlight / single-user mode for that user */
  filterUserId?: string;
  onSelectUser?: (userId: string) => void;
  compact?: boolean;
};

export function MoneyCharts({
  transactions,
  locale,
  filterUserId,
  onSelectUser,
  compact = false,
}: Props) {
  const { t } = useTranslation();
  const currency = useMemo(() => dominantCurrency(transactions), [transactions]);

  const totals = useMemo(() => {
    let incomeMinor = 0;
    let expenseMinor = 0;
    for (const tx of transactions) {
      if (tx.type === "INCOME") incomeMinor += tx.amountMinor;
      else expenseMinor += tx.amountMinor;
    }
    return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
  }, [transactions]);

  const byUser = useMemo(() => aggregateByUser(transactions), [transactions]);
  const byMonth = useMemo(
    () => aggregateByMonth(transactions, locale, compact ? 4 : 6),
    [transactions, locale, compact]
  );
  const byCategory = useMemo(
    () => aggregateByCategory(transactions).slice(0, compact ? 5 : 8),
    [transactions, compact]
  );

  const userMax = useMemo(
    () => Math.max(1, ...byUser.map((u) => Math.max(u.incomeMinor, u.expenseMinor))),
    [byUser]
  );
  const monthMax = useMemo(
    () => Math.max(1, ...byMonth.map((m) => Math.max(m.incomeMinor, m.expenseMinor))),
    [byMonth]
  );
  const categoryMax = useMemo(
    () => Math.max(1, ...byCategory.map((c) => Math.max(c.incomeMinor, c.expenseMinor))),
    [byCategory]
  );

  if (transactions.length === 0) return null;

  const showPerUser = !filterUserId && byUser.length > 0;

  return (
    <div className={`money-charts${compact ? " is-compact" : ""}`}>
      <div className="money-chart-summary admin-metrics">
        <article className="panel admin-metric money-metric income">
          <span className="muted small">{t("common.income")}</span>
          <strong className="tabular">
            {formatMoney(totals.incomeMinor, currency, locale)}
          </strong>
        </article>
        <article className="panel admin-metric money-metric expense">
          <span className="muted small">{t("common.expense")}</span>
          <strong className="tabular">
            {formatMoney(totals.expenseMinor, currency, locale)}
          </strong>
        </article>
        <article className="panel admin-metric money-metric net">
          <span className="muted small">{t("money.net")}</span>
          <strong className={`tabular${totals.netMinor < 0 ? " is-neg" : ""}`}>
            {formatMoney(totals.netMinor, currency, locale)}
          </strong>
        </article>
      </div>

      <div className={`money-chart-grid${showPerUser ? "" : " single"}`}>
        {showPerUser && (
          <article className="panel money-chart-panel">
            <h3>{t("admin.moneyByUser")}</h3>
            <ul className="money-user-chart">
              {byUser.map((u) => (
                <li key={u.userId}>
                  <button
                    type="button"
                    className="money-user-row"
                    onClick={() => onSelectUser?.(u.userId)}
                    disabled={!onSelectUser}
                  >
                    <div className="money-user-meta">
                      <strong>{u.name}</strong>
                      <span className="muted small">{u.email}</span>
                    </div>
                    <DualBar
                      income={u.incomeMinor}
                      expense={u.expenseMinor}
                      max={userMax}
                    />
                    <div className="money-user-amounts">
                      <span className="tabular income-amt">
                        {formatMoney(u.incomeMinor, u.currency, locale)}
                      </span>
                      <span className="tabular expense-amt">
                        {formatMoney(u.expenseMinor, u.currency, locale)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="money-legend" aria-hidden>
              <span>
                <i className="swatch income" /> {t("common.income")}
              </span>
              <span>
                <i className="swatch expense" /> {t("common.expense")}
              </span>
            </div>
          </article>
        )}

        <article className="panel money-chart-panel">
          <h3>{t("admin.moneyByMonth")}</h3>
          <div className="money-month-chart" role="img" aria-label={t("admin.moneyByMonth")}>
            {byMonth.map((m) => {
              const incomeH =
                monthMax > 0 ? Math.max((m.incomeMinor / monthMax) * 100, m.incomeMinor > 0 ? 4 : 0) : 0;
              const expenseH =
                monthMax > 0
                  ? Math.max((m.expenseMinor / monthMax) * 100, m.expenseMinor > 0 ? 4 : 0)
                  : 0;
              return (
                <div key={m.key} className="money-month-col">
                  <div className="money-month-bars">
                    <span
                      className="money-month-bar income"
                      style={{ height: `${incomeH}%` }}
                      title={formatMoney(m.incomeMinor, currency, locale)}
                    />
                    <span
                      className="money-month-bar expense"
                      style={{ height: `${expenseH}%` }}
                      title={formatMoney(m.expenseMinor, currency, locale)}
                    />
                  </div>
                  <span className="muted small money-month-label">{m.label}</span>
                </div>
              );
            })}
          </div>
          <div className="money-legend" aria-hidden>
            <span>
              <i className="swatch income" /> {t("common.income")}
            </span>
            <span>
              <i className="swatch expense" /> {t("common.expense")}
            </span>
          </div>
        </article>

        <article className="panel money-chart-panel">
          <h3>{t("admin.moneyByCategory")}</h3>
          {byCategory.length === 0 ? (
            <p className="muted">{t("common.empty")}</p>
          ) : (
            <ul className="money-category-chart">
              {byCategory.map((c) => (
                <li key={c.category}>
                  <div className="money-category-head">
                    <strong>{c.category}</strong>
                    <span className="muted small tabular">
                      {formatMoney(c.incomeMinor - c.expenseMinor, currency, locale)}
                    </span>
                  </div>
                  <DualBar
                    income={c.incomeMinor}
                    expense={c.expenseMinor}
                    max={categoryMax}
                  />
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </div>
  );
}
