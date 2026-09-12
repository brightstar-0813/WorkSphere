export type CalendarEntityKind = "job" | "profile";

export type CalendarLayerId = `${CalendarEntityKind}:${string}`;

export type CalendarLayerItem = {
  id: CalendarLayerId;
  kind: CalendarEntityKind;
  entityId: string;
  name: string;
};

/** Preset palette for per-job / per-profile calendars. */
export const LAYER_COLOR_PRESETS = [
  "#0b6e6e",
  "#1d4ed8",
  "#b45309",
  "#7c3aed",
  "#0e7490",
  "#059669",
  "#db2777",
  "#ca8a04",
  "#475569",
  "#ea4335",
  "#0078d4",
  "#6366f1",
] as const;

const STORAGE_KEY = "worksphere_calendar_entity_colors";
const ENABLED_KEY = "worksphere_calendar_entity_enabled";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (!HEX_RE.test(v)) return null;
  return v.toLowerCase();
}

export function jobLayerId(jobId: string): CalendarLayerId {
  return `job:${jobId}`;
}

export function profileLayerId(profileId: string): CalendarLayerId {
  return `profile:${profileId}`;
}

export function colorForIndex(index: number): string {
  return LAYER_COLOR_PRESETS[index % LAYER_COLOR_PRESETS.length]!;
}

export function loadEntityColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const hex = normalizeHex(v);
      if (hex) next[k] = hex;
    }
    return next;
  } catch {
    return {};
  }
}

export function saveEntityColors(colors: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
}

export function loadEnabledLayers(): Record<string, boolean> | null {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return null;
  }
}

export function saveEnabledLayers(enabled: Record<string, boolean>) {
  localStorage.setItem(ENABLED_KEY, JSON.stringify(enabled));
}

/** Ensure every layer has a color; returns updated map if changed. */
export function ensureLayerColors(
  layers: CalendarLayerItem[],
  colors: Record<string, string>
): Record<string, string> {
  let changed = false;
  const next = { ...colors };
  layers.forEach((layer, index) => {
    if (!next[layer.id]) {
      next[layer.id] = colorForIndex(index);
      changed = true;
    }
  });
  return changed ? next : colors;
}

export function ensureEnabledMap(
  layers: CalendarLayerItem[],
  stored: Record<string, boolean> | null
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const layer of layers) {
    next[layer.id] = stored?.[layer.id] ?? true;
  }
  return next;
}
