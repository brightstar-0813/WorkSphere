import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LAYER_COLOR_PRESETS,
  colorForIndex,
  type CalendarLayerId,
  type CalendarLayerItem,
} from "../lib/calendarLayerColors";

export type IcsLayerFeed = {
  id: string;
  label: string;
  color: string;
};

export type SharedLayer = {
  id: string;
  ownerId: string;
  label: string;
  color: string;
};

type ManagedRow = {
  key: string;
  label: string;
  color: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
  onColorChange: (color: string) => void;
  onResetColor: () => void;
  onRename?: (label: string) => void;
  onDelete?: () => void;
};

type Props = {
  jobs: CalendarLayerItem[];
  profiles: CalendarLayerItem[];
  enabled: Record<string, boolean>;
  colors: Record<string, string>;
  onToggle: (id: CalendarLayerId, on: boolean) => void;
  onColorChange: (id: CalendarLayerId, color: string) => void;
  feeds?: IcsLayerFeed[];
  feedVisible?: Record<string, boolean>;
  onFeedToggle?: (id: string, on: boolean) => void;
  onFeedColorChange?: (id: string, color: string) => void;
  onFeedLabelChange?: (id: string, label: string) => void;
  onFeedDelete?: (id: string) => void;
  shares?: SharedLayer[];
  shareVisible?: Record<string, boolean>;
  onShareToggle?: (id: string, on: boolean) => void;
  onShareColorChange?: (id: string, color: string) => void;
  onShareLabelChange?: (id: string, label: string) => void;
  onShareDelete?: (id: string) => void;
};

function ColorPanel({
  panelId,
  name,
  color,
  onColorChange,
  onReset,
}: {
  panelId: string;
  name: string;
  color: string;
  onColorChange: (color: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div id={panelId} className="layer-color-panel" role="dialog" aria-label={t("calendar.editColor", { name })}>
      <div className="layer-color-grid">
        {LAYER_COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`layer-color-option${preset.toLowerCase() === color.toLowerCase() ? " is-selected" : ""}`}
            style={{ background: preset }}
            aria-label={preset}
            onClick={() => onColorChange(preset)}
          />
        ))}
      </div>
      <div className="layer-color-custom">
        <label className="layer-color-custom-label">
          <span>{t("calendar.customColor")}</span>
          <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)} />
        </label>
        <button type="button" className="btn ghost layer-color-reset" onClick={onReset}>
          {t("calendar.resetColor")}
        </button>
      </div>
    </div>
  );
}

function ManagedLayerRow({
  row,
  editing,
  panelId,
  renaming,
  renameValue,
  onEdit,
  onStartRename,
  onRenameValue,
  onCommitRename,
  onCancelRename,
  rowRef,
}: {
  row: ManagedRow;
  editing: boolean;
  panelId: string;
  renaming: boolean;
  renameValue: string;
  onEdit: () => void;
  onStartRename: () => void;
  onRenameValue: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`layer-row${editing ? " is-editing" : ""}`} ref={rowRef}>
      <label className="layer-check">
        <input
          type="checkbox"
          checked={row.checked}
          onChange={(e) => row.onToggle(e.target.checked)}
          style={{ accentColor: row.color }}
        />
        {renaming && row.onRename ? (
          <input
            className="layer-rename"
            value={renameValue}
            autoFocus
            onChange={(e) => onRenameValue(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onCancelRename();
            }}
            aria-label={t("calendar.layers.renameFeed")}
          />
        ) : row.onRename ? (
          <button
            type="button"
            className="layer-name-btn"
            title={t("calendar.layers.renameFeed")}
            onClick={onStartRename}
          >
            {row.label}
          </button>
        ) : (
          <span className="layer-name" title={row.label}>
            {row.label}
          </span>
        )}
      </label>
      <button
        type="button"
        className="layer-color-swatch"
        style={{ background: row.color }}
        aria-label={t("calendar.editColor", { name: row.label })}
        aria-expanded={editing}
        aria-controls={editing ? panelId : undefined}
        title={t("calendar.editColor", { name: row.label })}
        onClick={onEdit}
      />
      {row.onDelete && (
        <button
          type="button"
          className="layer-delete btn ghost"
          aria-label={t("common.delete")}
          title={t("common.delete")}
          onClick={row.onDelete}
        >
          ×
        </button>
      )}
      {editing && (
        <ColorPanel
          panelId={panelId}
          name={row.label}
          color={row.color}
          onColorChange={row.onColorChange}
          onReset={row.onResetColor}
        />
      )}
    </div>
  );
}

export function CalendarLayers({
  jobs,
  profiles,
  enabled,
  colors,
  onToggle,
  onColorChange,
  feeds = [],
  feedVisible = {},
  onFeedToggle,
  onFeedColorChange,
  onFeedLabelChange,
  onFeedDelete,
  shares = [],
  shareVisible = {},
  onShareToggle,
  onShareColorChange,
  onShareLabelChange,
  onShareDelete,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const rowRefs = useRef<Partial<Record<string, HTMLDivElement | null>>>({});
  const panelId = useId();

  useEffect(() => {
    if (!editing) return;
    function onPointerDown(e: PointerEvent) {
      const row = rowRefs.current[editing!];
      if (row?.contains(e.target as Node)) return;
      setEditing(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setEditing(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  function renderEntityGroup(label: string, items: CalendarLayerItem[], emptyKey: string) {
    return (
      <div className="gcal-layer-group">
        <p className="nav-label">{label}</p>
        {items.length === 0 && <p className="muted small">{t(emptyKey)}</p>}
        {items.map((layer, index) => {
          const color = colors[layer.id] ?? colorForIndex(index);
          return (
            <ManagedLayerRow
              key={layer.id}
              row={{
                key: layer.id,
                label: layer.name,
                color,
                checked: enabled[layer.id] !== false,
                onToggle: (on) => onToggle(layer.id, on),
                onColorChange: (c) => {
                  onColorChange(layer.id, c);
                  setEditing(null);
                },
                onResetColor: () => {
                  onColorChange(layer.id, colorForIndex(index));
                  setEditing(null);
                },
              }}
              editing={editing === layer.id}
              panelId={panelId}
              renaming={false}
              renameValue=""
              onEdit={() => setEditing((cur) => (cur === layer.id ? null : layer.id))}
              onStartRename={() => undefined}
              onRenameValue={() => undefined}
              onCommitRename={() => undefined}
              onCancelRename={() => undefined}
              rowRef={(el) => {
                rowRefs.current[layer.id] = el;
              }}
            />
          );
        })}
      </div>
    );
  }

  function renderManagedGroup(
    label: string,
    emptyKey: string,
    rows: ManagedRow[],
    showWhenEmpty = false
  ) {
    if (rows.length === 0 && !showWhenEmpty) return null;
    return (
      <div className="gcal-layer-group">
        <p className="nav-label">{label}</p>
        {rows.length === 0 && <p className="muted small">{t(emptyKey)}</p>}
        {rows.map((row) => (
          <ManagedLayerRow
            key={row.key}
            row={row}
            editing={editing === row.key}
            panelId={panelId}
            renaming={renamingKey === row.key}
            renameValue={renameValue}
            onEdit={() => setEditing((cur) => (cur === row.key ? null : row.key))}
            onStartRename={() => {
              setRenamingKey(row.key);
              setRenameValue(row.label);
            }}
            onRenameValue={setRenameValue}
            onCommitRename={() => {
              const next = renameValue.trim();
              if (next && next !== row.label) row.onRename?.(next);
              setRenamingKey(null);
            }}
            onCancelRename={() => setRenamingKey(null)}
            rowRef={(el) => {
              rowRefs.current[row.key] = el;
            }}
          />
        ))}
      </div>
    );
  }

  const feedRows: ManagedRow[] = feeds.map((feed, index) => {
    const color = feed.color || colorForIndex(index);
    const key = `feed:${feed.id}`;
    return {
      key,
      label: feed.label,
      color,
      checked: feedVisible[feed.id] !== false,
      onToggle: (on) => onFeedToggle?.(feed.id, on),
      onColorChange: (c) => {
        onFeedColorChange?.(feed.id, c);
        setEditing(null);
      },
      onResetColor: () => {
        onFeedColorChange?.(feed.id, colorForIndex(index));
        setEditing(null);
      },
      onRename: (label) => onFeedLabelChange?.(feed.id, label),
      onDelete: onFeedDelete ? () => onFeedDelete(feed.id) : undefined,
    };
  });

  const shareRows: ManagedRow[] = shares.map((share, index) => {
    const color = share.color || colorForIndex(index + 3);
    const key = `share:${share.id}`;
    return {
      key,
      label: share.label,
      color,
      checked: shareVisible[share.id] !== false,
      onToggle: (on) => onShareToggle?.(share.id, on),
      onColorChange: (c) => {
        onShareColorChange?.(share.id, c);
        setEditing(null);
      },
      onResetColor: () => {
        onShareColorChange?.(share.id, colorForIndex(index + 3));
        setEditing(null);
      },
      onRename: (label) => onShareLabelChange?.(share.id, label),
      onDelete: onShareDelete ? () => onShareDelete(share.id) : undefined,
    };
  });

  return (
    <div className="gcal-layers">
      {renderEntityGroup(t("calendar.layers.jobs"), jobs, "calendar.layers.noJobs")}
      {renderEntityGroup(t("calendar.layers.profiles"), profiles, "calendar.layers.noProfiles")}
      {renderManagedGroup(t("calendar.layers.external"), "calendar.layers.noExternal", feedRows)}
      {renderManagedGroup(t("calendar.layers.shared"), "calendar.layers.noShared", shareRows, true)}
    </div>
  );
}
