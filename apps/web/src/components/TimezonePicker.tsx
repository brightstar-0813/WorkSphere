import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TIME_ZONE_OPTIONS,
  detectTimeZone,
  formatGmtOffset,
  zoneOptionLabel,
} from "../lib/timezone";

type Props = {
  value: string;
  onChange: (timeZone: string) => void;
  /** Compact trigger showing only GMT±XX (calendar gutter). */
  compact?: boolean;
  className?: string;
};

export function TimezonePicker({ value, onChange, compact, className }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const detected = useMemo(() => detectTimeZone(), []);
  const gmt = formatGmtOffset(value || detected);

  const options = useMemo(() => {
    const ids = new Set(TIME_ZONE_OPTIONS.map((z) => z.id));
    const list = [...TIME_ZONE_OPTIONS];
    if (detected && !ids.has(detected)) {
      list.unshift({ id: detected, label: t("calendar.timezone.detected") });
    } else if (detected) {
      // Move detected to top
      const idx = list.findIndex((z) => z.id === detected);
      if (idx > 0) {
        const [row] = list.splice(idx, 1);
        list.unshift(row);
      }
    }
    if (value && !list.some((z) => z.id === value)) {
      list.unshift({ id: value, label: value.replace(/_/g, " ") });
    }
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (z) =>
        z.id.toLowerCase().includes(query) ||
        z.label.toLowerCase().includes(query) ||
        formatGmtOffset(z.id).toLowerCase().includes(query)
    );
  }, [detected, value, q, t]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`tz-picker${compact ? " compact" : ""}${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        className={compact ? "tz-picker-trigger compact" : "tz-picker-trigger"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={zoneOptionLabel(value || detected)}
      >
        {compact ? gmt : zoneOptionLabel(value || detected)}
      </button>
      {open && (
        <div className="tz-picker-menu" role="listbox">
          <input
            className="tz-picker-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("calendar.timezone.search")}
            autoFocus
          />
          <ul className="tz-picker-list">
            {options.map((z) => {
              const selected = z.id === (value || detected);
              return (
                <li key={z.id}>
                  <button
                    type="button"
                    className={`tz-picker-option${selected ? " selected" : ""}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(z.id);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    <span className="tz-picker-gmt">{formatGmtOffset(z.id)}</span>
                    <span className="tz-picker-name">{z.label}</span>
                  </button>
                </li>
              );
            })}
            {options.length === 0 && <li className="tz-picker-empty muted small">{t("common.empty")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
