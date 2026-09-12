import { useTranslation } from "react-i18next";

type Props = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
};

export function Pagination({ page, totalPages, total, pageSize, onPageChange, disabled }: Props) {
  const { t } = useTranslation();
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label={t("common.pagination")}>
      <p className="muted small tabular pagination-summary">
        {t("common.pageRange", { from, to, total })}
      </p>
      <div className="pagination-controls">
        <button
          type="button"
          className="btn ghost"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t("common.prev")}
        </button>
        <span className="muted small tabular pagination-page">
          {t("common.pageOf", { page, totalPages })}
        </span>
        <button
          type="button"
          className="btn ghost"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t("common.next")}
        </button>
      </div>
    </nav>
  );
}
