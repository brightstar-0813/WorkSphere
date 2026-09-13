import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Multi-row selection for the current page/list of ids.
 * Select-all applies to the provided `itemIds` (typically the visible page).
 */
export function useRowSelection(itemIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const idKey = itemIds.join("\0");

  useEffect(() => {
    const allowed = new Set(itemIds);
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allowed.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
    // itemIds identity via idKey — avoid re-running on new array refs with same ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const selectedOnPage = useMemo(
    () => itemIds.filter((id) => selected.has(id)),
    [itemIds, selected],
  );

  const allSelected = itemIds.length > 0 && selectedOnPage.length === itemIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;
  const selectedCount = selected.size;
  const selectedIds = useMemo(() => [...selected], [selected]);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allOnPage = itemIds.length > 0 && itemIds.every((id) => prev.has(id));
      if (allOnPage) {
        const next = new Set(prev);
        for (const id of itemIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of itemIds) next.add(id);
      return next;
    });
  }, [itemIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    selected,
    selectedIds,
    selectedCount,
    allSelected,
    someSelected,
    isSelected,
    toggle,
    toggleAll,
    clear,
  };
}

export type RowSelection = ReturnType<typeof useRowSelection>;
