import { useTranslation } from "react-i18next";
import { RowSelectCheckbox } from "./RowSelectCheckbox";
import type { RowSelection } from "../hooks/useRowSelection";

type Props = {
  selection: RowSelection;
  /** Ids currently shown (page / visible list) — drives select-all. */
  pageIds: string[];
  disabled?: boolean;
  onDeleteSelected?: () => void;
  deleteBusy?: boolean;
};

/** Toolbar: select all (page), count, clear, optional bulk delete. */
export function SelectionBar({
  selection,
  pageIds,
  disabled,
  onDeleteSelected,
  deleteBusy,
}: Props) {
  const { t } = useTranslation();
  const { allSelected, someSelected, selectedCount, toggleAll, clear } = selection;
  const hasPage = pageIds.length > 0;

  if (!hasPage) return null;

  return (
    <div className="selection-bar" role="group" aria-label={t("common.selection")}>
      <RowSelectCheckbox
        checked={allSelected}
        indeterminate={someSelected}
        onChange={toggleAll}
        label={allSelected ? t("common.selectNone") : t("common.selectAll")}
        disabled={disabled || deleteBusy}
      />
      <span className="muted small tabular selection-bar-count">
        {selectedCount > 0
          ? t("common.selectedCount", { count: selectedCount })
          : t("common.selectAll")}
      </span>
      {selectedCount > 0 ? (
        <div className="selection-bar-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={disabled || deleteBusy}
            onClick={clear}
          >
            {t("common.clearSelection")}
          </button>
          {onDeleteSelected ? (
            <button
              type="button"
              className="btn ghost"
              disabled={disabled || deleteBusy || selectedCount === 0}
              onClick={onDeleteSelected}
            >
              {deleteBusy ? t("common.saving") : t("common.deleteSelected")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
