import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../auth";
import { CalendarIntegrations } from "../components/CalendarIntegrations";
import { CalendarLayers, type IcsLayerFeed, type SharedLayer } from "../components/CalendarLayers";
import { huntingProfileStorageKey, isAllProfilesId } from "../components/HuntingProfileSwitcher";
import { TimezonePicker } from "../components/TimezonePicker";
import {
  ensureEnabledMap,
  ensureLayerColors,
  jobLayerId,
  loadEnabledLayers,
  loadEntityColors,
  profileLayerId,
  saveEnabledLayers,
  saveEntityColors,
  type CalendarLayerId,
  type CalendarLayerItem,
} from "../lib/calendarLayerColors";
import type { CalEvent } from "../types/calendar";
import {
  addZonedDays,
  DEFAULT_TIME_ZONE,
  endOfZonedDay,
  eventOccursOnZonedDay,
  formatZonedDayHeader,
  formatZonedMonthYear,
  formatZonedTime,
  formatZonedWeekday,
  fromZonedInput,
  resolveAppTimeZone,
  sameZonedDay,
  startOfZonedDay,
  startOfZonedMonth,
  startOfZonedWeek,
  toZonedDateInput,
  toZonedInput,
  wallTimeToUtc,
  zonedDayNumber,
  zonedHourOffsetPx,
  zonedMonthIndex,
  zonedParts,
} from "../lib/timezone";

type ViewMode = "month" | "week" | "day";

type Draft = {
  id?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  description: string;
  sourceType: string;
  sourceId?: string | null;
  /** job:{id} or profile:{id} for new events */
  calendarId: string;
  tag?: string;
  remindMinutes: number;
  alertEnabled: boolean;
  attendees: string;
  inviteVia: "AUTO" | "GOOGLE" | "OUTLOOK" | "NONE";
  htmlLink?: string | null;
  readOnly?: boolean;
  sharedFrom?: { id: string; email: string; name: string } | null;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_PX = 48;
const FEED_VISIBLE_KEY = "worksphere_calendar_ics_visible";
const SHARE_VISIBLE_KEY = "worksphere_calendar_share_visible";

function loadFeedVisible(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FEED_VISIBLE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveFeedVisible(map: Record<string, boolean>) {
  localStorage.setItem(FEED_VISIBLE_KEY, JSON.stringify(map));
}

function loadShareVisible(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SHARE_VISIBLE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveShareVisible(map: Record<string, boolean>) {
  localStorage.setItem(SHARE_VISIBLE_KEY, JSON.stringify(map));
}

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function displayFeedLabel(label: string, url: string) {
  const raw = label?.trim() ?? "";
  if (raw.length >= 2 && !/^outlook(\s+ics)?$/i.test(raw)) return raw;
  return hostnameFromUrl(url) || raw || "Calendar";
}

function emptyDraft(day: Date | undefined, timeZone: string, calendarId = ""): Draft {
  let start: Date;
  if (day) {
    const p = zonedParts(day, timeZone);
    start = wallTimeToUtc(p.year, p.month, p.day, 9, 0, 0, timeZone);
  } else {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const p = zonedParts(soon, timeZone);
    start = wallTimeToUtc(p.year, p.month, p.day, p.hour, 0, 0, timeZone);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    startsAt: toZonedInput(start.toISOString(), timeZone),
    endsAt: toZonedInput(end.toISOString(), timeZone),
    allDay: false,
    description: "",
    sourceType: "MANUAL",
    sourceId: null,
    calendarId,
    remindMinutes: 30,
    alertEnabled: true,
    attendees: "",
    inviteVia: "AUTO",
  };
}

function formatEventTime(ev: CalEvent, locale: string, timeZone: string) {
  if (ev.allDay) return "";
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (!ev.endsAt) return formatZonedTime(ev.startsAt, locale, timeZone, opts);
  return `${formatZonedTime(ev.startsAt, locale, timeZone, opts)} – ${formatZonedTime(ev.endsAt, locale, timeZone, opts)}`;
}

/** Visual density for timed blocks — content must fit height without mid-glyph clipping. */
type BlockDensity = "xs" | "sm" | "md";

function blockGeometry(ev: CalEvent, day: Date, timeZone: string) {
  const dayStart = startOfZonedDay(day, timeZone);
  const dayEnd = addZonedDays(dayStart, 1, timeZone);
  const start = new Date(ev.startsAt);
  const end = ev.endsAt ? new Date(ev.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);

  if (ev.allDay) {
    return { top: 0, height: 26 };
  }

  const clippedStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
  const clippedEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
  const top = zonedHourOffsetPx(clippedStart, timeZone, HOUR_PX);
  const height = Math.max(
    22,
    ((clippedEnd.getTime() - clippedStart.getTime()) / 3600000) * HOUR_PX
  );
  return { top, height };
}

function blockDensity(height: number): BlockDensity {
  if (height < 34) return "xs";
  if (height < 52) return "sm";
  return "md";
}

type TimedLane = { ev: CalEvent; top: number; height: number; col: number; colCount: number };

/** Pack overlapping timed events into columns (Google Calendar–style). */
function layoutTimedEvents(events: CalEvent[], day: Date, timeZone: string): TimedLane[] {
  const timed = events
    .filter((ev) => !ev.allDay)
    .map((ev) => {
      const { top, height } = blockGeometry(ev, day, timeZone);
      return { ev, top, height, end: top + height };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  type Active = { end: number; col: number };
  const result: TimedLane[] = [];
  let cluster: typeof timed = [];
  let active: Active[] = [];
  let clusterMaxCol = 0;

  const flushCluster = () => {
    const colCount = clusterMaxCol + 1;
    for (const item of cluster) {
      const lane = result.find((r) => r.ev.id === item.ev.id);
      if (lane) lane.colCount = colCount;
    }
    cluster = [];
    active = [];
    clusterMaxCol = 0;
  };

  for (const item of timed) {
    active = active.filter((a) => a.end > item.top + 0.5);
    if (active.length === 0 && cluster.length > 0) flushCluster();

    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col += 1;
    clusterMaxCol = Math.max(clusterMaxCol, col);
    active.push({ end: item.end, col });
    cluster.push(item);
    result.push({ ev: item.ev, top: item.top, height: item.height, col, colCount: 1 });
  }
  if (cluster.length > 0) flushCluster();
  return result;
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const { user, setTimeZone } = useAuth();
  const timeZone = resolveAppTimeZone(user?.timeZone);

  const [items, setItems] = useState<CalEvent[]>([]);
  const [cursor, setCursor] = useState(() => startOfZonedDay(new Date(), DEFAULT_TIME_ZONE));
  const [view, setView] = useState<ViewMode>("week");
  const [selectedDay, setSelectedDay] = useState(() => startOfZonedDay(new Date(), DEFAULT_TIME_ZONE));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobLayers, setJobLayers] = useState<CalendarLayerItem[]>([]);
  const [profileLayers, setProfileLayers] = useState<CalendarLayerItem[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [entityColors, setEntityColors] = useState(loadEntityColors);
  const [icsFeeds, setIcsFeeds] = useState<IcsLayerFeed[]>([]);
  const [feedVisible, setFeedVisible] = useState<Record<string, boolean>>(loadFeedVisible);
  const [sharedLayers, setSharedLayers] = useState<SharedLayer[]>([]);
  const [shareVisible, setShareVisible] = useState<Record<string, boolean>>(loadShareVisible);
  const [now, setNow] = useState(() => new Date());

  const allEntityLayers = useMemo(
    () => [...jobLayers, ...profileLayers],
    [jobLayers, profileLayers]
  );

  function setEntityColor(id: CalendarLayerId, color: string) {
    setEntityColors((prev) => {
      const next = { ...prev, [id]: color };
      saveEntityColors(next);
      return next;
    });
  }

  function setLayerEnabled(id: CalendarLayerId, on: boolean) {
    setEnabled((prev) => {
      const next = { ...prev, [id]: on };
      saveEnabledLayers(next);
      return next;
    });
  }

  function setFeedVisibility(id: string, on: boolean) {
    setFeedVisible((prev) => {
      const next = { ...prev, [id]: on };
      saveFeedVisible(next);
      return next;
    });
  }

  function setShareVisibility(id: string, on: boolean) {
    setShareVisible((prev) => {
      const next = { ...prev, [id]: on };
      saveShareVisible(next);
      return next;
    });
  }

  const refreshCatalog = useCallback(async () => {
    const [jobs, profiles] = await Promise.all([
      api<{ id: string; title: string }[]>("/jobs"),
      api<{ id: string; name: string; label: string; active: boolean }[]>("/hunting/profiles"),
    ]);
    const nextJobs: CalendarLayerItem[] = jobs.map((j) => ({
      id: jobLayerId(j.id),
      kind: "job",
      entityId: j.id,
      name: j.title,
    }));
    const nextProfiles: CalendarLayerItem[] = profiles
      .filter((p) => p.active)
      .map((p) => ({
        id: profileLayerId(p.id),
        kind: "profile",
        entityId: p.id,
        name: p.label.trim() || p.name,
      }));
    setJobLayers(nextJobs);
    setProfileLayers(nextProfiles);
    const catalog = [...nextJobs, ...nextProfiles];
    setEntityColors((prev) => {
      const next = ensureLayerColors(catalog, prev);
      if (next !== prev) saveEntityColors(next);
      return next;
    });
    setEnabled((prev) => {
      const stored = Object.keys(prev).length ? prev : loadEnabledLayers();
      const next = ensureEnabledMap(catalog, stored);
      saveEnabledLayers(next);
      return next;
    });
  }, []);

  const refreshIcsFeeds = useCallback(async () => {
    try {
      const integ = await api<{
        icsFeeds: { id: string; url: string; label: string; color: string }[];
      }>("/integrations/calendar");
      setIcsFeeds(
        integ.icsFeeds.map((f) => ({
          id: f.id,
          label: displayFeedLabel(f.label, f.url),
          color: f.color || "#6366f1",
        }))
      );
      setFeedVisible((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const f of integ.icsFeeds) {
          if (next[f.id] === undefined) {
            next[f.id] = true;
            changed = true;
          }
        }
        if (changed) saveFeedVisible(next);
        return changed ? next : prev;
      });
    } catch {
      /* ignore */
    }
  }, []);

  const refreshShares = useCallback(async () => {
    try {
      const lists = await api<{
        outgoing: {
          id: string;
          status: string;
          ownerId: string | null;
          label: string;
          color: string;
          owner: { id: string; name: string };
        }[];
      }>("/calendar/shares");
      const accepted = lists.outgoing.filter((s) => s.status === "ACCEPTED" && s.ownerId);
      setSharedLayers(
        accepted.map((s) => ({
          id: s.id,
          ownerId: s.ownerId!,
          label: s.label || s.owner.name,
          color: s.color || "#6366f1",
        }))
      );
      setShareVisible((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const s of accepted) {
          if (next[s.id] === undefined) {
            next[s.id] = true;
            changed = true;
          }
        }
        if (changed) saveShareVisible(next);
        return changed ? next : prev;
      });
    } catch {
      /* ignore */
    }
  }, []);

  async function patchIcsFeed(id: string, body: { label?: string; color?: string }) {
    const updated = await api<{ id: string; url: string; label: string; color: string }>(
      `/integrations/calendar/ics/${id}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    setIcsFeeds((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              id: updated.id,
              label: displayFeedLabel(updated.label, updated.url),
              color: updated.color || "#6366f1",
            }
          : f
      )
    );
  }

  async function deleteIcsFeed(id: string) {
    await api(`/integrations/calendar/ics/${id}`, { method: "DELETE" });
    setIcsFeeds((prev) => prev.filter((f) => f.id !== id));
    await load();
  }

  async function patchShare(id: string, body: { label?: string; color?: string }) {
    const updated = await api<SharedLayer & { owner?: { name: string } }>(
      `/calendar/shares/${id}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    setSharedLayers((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              label: updated.label || s.label,
              color: updated.color || s.color,
            }
          : s
      )
    );
  }

  async function deleteShare(id: string) {
    await api(`/calendar/shares/${id}`, { method: "DELETE" });
    setSharedLayers((prev) => prev.filter((s) => s.id !== id));
    await load();
  }

  useEffect(() => {
    const tick = () => setNow(new Date());
    const alignMs = 60_000 - (Date.now() % 60_000) + 50;
    let intervalId = 0;
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 60_000);
    }, alignMs);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  // Re-anchor civil dates when the user changes timezone
  useEffect(() => {
    const p = zonedParts(cursor, timeZone);
    const anchored = wallTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
    setCursor(anchored);
    const sp = zonedParts(selectedDay, timeZone);
    setSelectedDay(wallTimeToUtc(sp.year, sp.month, sp.day, 0, 0, 0, timeZone));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on timezone change
  }, [timeZone]);

  const range = useMemo(() => {
    if (view === "month") {
      const monthStart = startOfZonedMonth(cursor, timeZone);
      const gridStart = startOfZonedWeek(monthStart, timeZone);
      return { from: gridStart, to: addZonedDays(gridStart, 41, timeZone) };
    }
    if (view === "week") {
      const weekStart = startOfZonedWeek(cursor, timeZone);
      return { from: weekStart, to: endOfZonedDay(addZonedDays(weekStart, 6, timeZone), timeZone) };
    }
    return { from: startOfZonedDay(cursor, timeZone), to: endOfZonedDay(cursor, timeZone) };
  }, [cursor, view, timeZone]);

  const lastIcsSyncAtRef = useRef(0);

  async function maybeSyncIcsFeeds() {
    if (icsFeeds.length === 0) return;
    const now = Date.now();
    // Throttle automatic pull so month/week navigation stays responsive.
    if (now - lastIcsSyncAtRef.current < 60_000) return;
    lastIcsSyncAtRef.current = now;
    const padMs = 7 * 86400000;
    try {
      await api("/integrations/calendar/sync", {
        method: "POST",
        body: JSON.stringify({
          provider: "ALL",
          from: new Date(range.from.getTime() - padMs).toISOString(),
          to: new Date(range.to.getTime() + padMs).toISOString(),
        }),
      });
    } catch {
      /* best-effort — still show whatever is already in DB */
    }
  }

  async function load() {
    setLoading(true);
    try {
      await maybeSyncIcsFeeds();

      const jobIds = jobLayers.filter((j) => enabled[j.id] !== false).map((j) => j.entityId);
      const profileIds = profileLayers
        .filter((p) => enabled[p.id] !== false)
        .map((p) => p.entityId);
      const enabledFeedIds = icsFeeds.filter((f) => feedVisible[f.id] !== false).map((f) => f.id);
      const enabledShares = sharedLayers.filter((s) => shareVisible[s.id] !== false);
      const shareOwnerIds = enabledShares.map((s) => s.ownerId);

      const entityPromise =
        jobIds.length || profileIds.length
          ? (() => {
              const entityParams = new URLSearchParams({
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                shared: "0",
              });
              if (jobIds.length) entityParams.set("jobIds", jobIds.join(","));
              if (profileIds.length) entityParams.set("profileIds", profileIds.join(","));
              return api<CalEvent[]>(`/calendar?${entityParams}`);
            })()
          : Promise.resolve([] as CalEvent[]);

      const feedPromise = enabledFeedIds.length
        ? (() => {
            const feedParams = new URLSearchParams({
              from: range.from.toISOString(),
              to: range.to.toISOString(),
              types: "GOOGLE,OUTLOOK",
              shared: "0",
            });
            return api<CalEvent[]>(`/calendar?${feedParams}`);
          })()
        : Promise.resolve([] as CalEvent[]);

      const sharePromise = shareOwnerIds.length
        ? (() => {
            const shareParams = new URLSearchParams({
              from: range.from.toISOString(),
              to: range.to.toISOString(),
              shared: "1",
              shareOwnerIds: shareOwnerIds.join(","),
            });
            return api<CalEvent[]>(`/calendar?${shareParams}`);
          })()
        : Promise.resolve([] as CalEvent[]);

      const [entityEvents, feedEvents, sharedEvents] = await Promise.all([
        entityPromise,
        feedPromise,
        sharePromise,
      ]);

      const feedIdSet = new Set(enabledFeedIds);
      const data = [
        ...entityEvents,
        ...feedEvents.filter(
          (ev) =>
            (ev.sourceType === "GOOGLE" || ev.sourceType === "OUTLOOK") &&
            ev.sourceId &&
            feedIdSet.has(ev.sourceId),
        ),
        ...sharedEvents.filter((ev) => Boolean(ev.sharedFrom)),
      ];
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([refreshCatalog(), refreshIcsFeeds(), refreshShares()]);
  }, [refreshCatalog, refreshIcsFeeds, refreshShares]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on range/layers/feeds/shares
  }, [
    range.from.getTime(),
    range.to.getTime(),
    jobLayers,
    profileLayers,
    enabled,
    icsFeeds,
    feedVisible,
    sharedLayers,
    shareVisible,
  ]);

  const feedColorById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of icsFeeds) map[f.id] = f.color;
    return map;
  }, [icsFeeds]);

  const shareColorByOwnerId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of sharedLayers) map[s.ownerId] = s.color;
    return map;
  }, [sharedLayers]);

  function eventAccentStyle(ev: CalEvent): CSSProperties | undefined {
    if (ev.sharedFrom?.id && shareColorByOwnerId[ev.sharedFrom.id]) {
      return { background: shareColorByOwnerId[ev.sharedFrom.id] };
    }
    if ((ev.sourceType === "GOOGLE" || ev.sourceType === "OUTLOOK") && ev.sourceId) {
      const color = feedColorById[ev.sourceId];
      if (color) return { background: color };
    }
    if (ev.layerKey && entityColors[ev.layerKey]) {
      return { background: entityColors[ev.layerKey] };
    }
    return undefined;
  }

  const defaultCalendarId = useMemo(() => {
    const firstOn = allEntityLayers.find((l) => enabled[l.id] !== false);
    return firstOn?.id ?? allEntityLayers[0]?.id ?? "";
  }, [allEntityLayers, enabled]);
  const monthCells = useMemo(() => {
    const monthStart = startOfZonedMonth(cursor, timeZone);
    const gridStart = startOfZonedWeek(monthStart, timeZone);
    return Array.from({ length: 42 }, (_, i) => addZonedDays(gridStart, i, timeZone));
  }, [cursor, timeZone]);

  const weekDays = useMemo(() => {
    const weekStart = startOfZonedWeek(cursor, timeZone);
    return Array.from({ length: 7 }, (_, i) => addZonedDays(weekStart, i, timeZone));
  }, [cursor, timeZone]);

  const timegridDays = useMemo(
    () => (view === "week" ? weekDays : [cursor]),
    [view, weekDays, cursor]
  );

  const hasAllDayEvents = useMemo(
    () =>
      timegridDays.some((day) =>
        items.some((ev) => ev.allDay && eventOccursOnZonedDay(ev, day, timeZone))
      ),
    [timegridDays, items, timeZone]
  );

  function eventsForDay(day: Date) {
    return items.filter((ev) => eventOccursOnZonedDay(ev, day, timeZone));
  }

  function openCreate(day: Date, hour?: number) {
    const d = emptyDraft(day, timeZone, defaultCalendarId);
    if (hour !== undefined) {
      const p = zonedParts(day, timeZone);
      const start = wallTimeToUtc(p.year, p.month, p.day, hour, 0, 0, timeZone);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      d.startsAt = toZonedInput(start.toISOString(), timeZone);
      d.endsAt = toZonedInput(end.toISOString(), timeZone);
    }
    setSelectedDay(startOfZonedDay(day, timeZone));
    setDraft(d);
    setError("");
  }

  function openEdit(ev: CalEvent) {
    setSelectedDay(startOfZonedDay(new Date(ev.startsAt), timeZone));
    setDraft({
      id: ev.id,
      title: ev.title,
      startsAt: ev.allDay ? toZonedDateInput(ev.startsAt, timeZone) : toZonedInput(ev.startsAt, timeZone),
      endsAt: ev.endsAt
        ? ev.allDay
          ? toZonedDateInput(ev.endsAt, timeZone)
          : toZonedInput(ev.endsAt, timeZone)
        : "",
      allDay: ev.allDay,
      description: ev.description ?? "",
      sourceType: ev.sourceType,
      sourceId: ev.sourceId,
      calendarId: ev.layerKey ?? "",
      tag: ev.tag,
      remindMinutes: ev.remindMinutes ?? 30,
      alertEnabled: ev.alertEnabled !== false,
      attendees: ev.attendees ?? "",
      inviteVia: "NONE",
      htmlLink: ev.htmlLink,
      readOnly: Boolean(ev.readOnly || ev.sharedFrom),
      sharedFrom: ev.sharedFrom ?? null,
    });
    setError("");
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft?.title.trim()) return;
    if (!draft.id && !draft.calendarId) {
      setError(t("calendar.layers.pickCalendar"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const startsAt = draft.allDay
        ? fromZonedInput(`${draft.startsAt}T00:00`, timeZone)
        : fromZonedInput(draft.startsAt, timeZone);
      const endsAt = draft.endsAt
        ? draft.allDay
          ? fromZonedInput(`${draft.endsAt}T23:59`, timeZone)
          : fromZonedInput(draft.endsAt, timeZone)
        : null;
      if (!startsAt) throw new Error("Invalid start");

      const attendees = draft.attendees
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const body = {
        title: draft.title.trim(),
        startsAt,
        endsAt,
        allDay: draft.allDay,
        description: draft.description,
        remindMinutes: draft.alertEnabled ? draft.remindMinutes : 0,
        alertEnabled: draft.alertEnabled,
        attendees,
        inviteVia: draft.id ? "NONE" : attendees.length ? draft.inviteVia : "NONE",
      };

      if (draft.id) {
        await api(`/calendar/${draft.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const [kind, entityId] = draft.calendarId.split(":");
        const sourceType = kind === "profile" ? "HUNTING" : "JOB";
        await api("/calendar", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            sourceType,
            sourceId: entityId ?? null,
            tag: "SCHEDULE",
          }),
        });
      }
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeDraft() {
    if (!draft?.id) {
      setDraft(null);
      return;
    }
    setBusy(true);
    try {
      await api(`/calendar/${draft.id}`, { method: "DELETE" });
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function shift(dir: -1 | 1) {
    if (view === "month") {
      const p = zonedParts(cursor, timeZone);
      let month = p.month + dir;
      let year = p.year;
      if (month < 1) {
        month = 12;
        year -= 1;
      } else if (month > 12) {
        month = 1;
        year += 1;
      }
      setCursor(wallTimeToUtc(year, month, 1, 0, 0, 0, timeZone));
    } else if (view === "week") setCursor(addZonedDays(cursor, dir * 7, timeZone));
    else setCursor(addZonedDays(cursor, dir, timeZone));
  }

  function goToday() {
    const today = startOfZonedDay(new Date(), timeZone);
    setCursor(today);
    setSelectedDay(today);
  }

  const titleLabel =
    view === "day"
      ? formatZonedDayHeader(cursor, i18n.language, timeZone)
      : formatZonedMonthYear(cursor, i18n.language, timeZone);

  return (
    <section className="page calendar-page gcal">
      <div className="gcal-shell">
        <aside className="gcal-rail">
          <button className="btn primary gcal-create" type="button" onClick={() => openCreate(selectedDay)}>
            {t("calendar.createCta")}
          </button>

          <CalendarLayers
            jobs={jobLayers}
            profiles={profileLayers}
            enabled={enabled}
            colors={entityColors}
            onToggle={setLayerEnabled}
            onColorChange={setEntityColor}
            feeds={icsFeeds}
            feedVisible={feedVisible}
            onFeedToggle={setFeedVisibility}
            onFeedColorChange={(id, color) => void patchIcsFeed(id, { color })}
            onFeedLabelChange={(id, label) => void patchIcsFeed(id, { label })}
            onFeedDelete={(id) => void deleteIcsFeed(id)}
            shares={sharedLayers}
            shareVisible={shareVisible}
            onShareToggle={setShareVisibility}
            onShareColorChange={(id, color) => void patchShare(id, { color })}
            onShareLabelChange={(id, label) => void patchShare(id, { label })}
            onShareDelete={(id) => void deleteShare(id)}
          />

          <CalendarIntegrations
            syncRange={range}
            onSynced={() => {
              lastIcsSyncAtRef.current = 0;
              void refreshIcsFeeds();
              void refreshShares();
              void load();
            }}
          />
        </aside>

        <div className="gcal-main">
          <div className="cal-toolbar">
            <div className="cal-nav">
              <button className="btn" type="button" onClick={goToday}>
                {t("calendar.today")}
              </button>
              <button
                className="btn ghost"
                type="button"
                aria-label={t("common.prev")}
                onClick={() => shift(-1)}
              >
                ‹
              </button>
              <button
                className="btn ghost"
                type="button"
                aria-label={t("common.next")}
                onClick={() => shift(1)}
              >
                ›
              </button>
              <strong className="cal-period">{titleLabel}</strong>
            </div>
            <div className="cal-views">
              {(["day", "week", "month"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`btn${view === mode ? " primary" : " ghost"}`}
                  onClick={() => setView(mode)}
                >
                  {t(`calendar.view.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="cal-main panel">
            {loading && <p className="muted small hunting-pad">{t("common.loading")}</p>}
            {view === "month" && (
              <div className="cal-month">
                <div className="cal-weekdays">
                  {weekDays.map((d) => (
                    <div key={d.toISOString()} className="cal-weekday">
                      {formatZonedWeekday(d, i18n.language, timeZone)}
                    </div>
                  ))}
                </div>
                <div className="cal-month-grid">
                  {monthCells.map((day) => {
                    const inMonth = zonedMonthIndex(day, timeZone) === zonedMonthIndex(cursor, timeZone);
                    const dayEvents = eventsForDay(day);
                    return (
                      <button
                        type="button"
                        key={day.toISOString()}
                        className={`cal-cell${inMonth ? "" : " muted-month"}${sameZonedDay(day, now, timeZone) ? " today" : ""}${sameZonedDay(day, selectedDay, timeZone) ? " selected" : ""}`}
                        onClick={() => setSelectedDay(startOfZonedDay(day, timeZone))}
                        onDoubleClick={() => openCreate(day)}
                      >
                        <span className="cal-date">{zonedDayNumber(day, timeZone)}</span>
                        <div className="cal-chips">
                          {dayEvents.slice(0, 4).map((ev) => {
                            const label = ev.allDay
                              ? ev.title
                              : `${formatEventTime(ev, i18n.language, timeZone)} ${ev.title}`;
                            return (
                              <button
                                type="button"
                                key={ev.id}
                                className={`cal-chip src-${ev.sourceType.toLowerCase()}${ev.sharedFrom ? " is-shared" : ""}`}
                                style={eventAccentStyle(ev)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(ev);
                                }}
                                title={`${ev.title} ${formatEventTime(ev, i18n.language, timeZone)}`}
                                aria-label={label}
                              >
                                {label}
                              </button>
                            );
                          })}
                          {dayEvents.length > 4 && (
                            <span className="cal-more">+{dayEvents.length - 4}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(view === "week" || view === "day") && (
              <div className={`cal-timegrid ${view}`}>
                <div className="cal-timegrid-head">
                  <div className="cal-gutter cal-tz-gutter">
                    <TimezonePicker
                      compact
                      value={timeZone}
                      onChange={(tz) => void setTimeZone(tz)}
                    />
                  </div>
                  {(view === "week" ? weekDays : [cursor]).map((day) => (
                    <button
                      type="button"
                      key={day.toISOString()}
                      className={`cal-dayhead${sameZonedDay(day, now, timeZone) ? " today" : ""}${sameZonedDay(day, selectedDay, timeZone) ? " selected" : ""}`}
                      onClick={() => {
                        setSelectedDay(startOfZonedDay(day, timeZone));
                        if (view === "day") setCursor(startOfZonedDay(day, timeZone));
                      }}
                      onDoubleClick={() => openCreate(day)}
                    >
                      {formatZonedDayHeader(day, i18n.language, timeZone)}
                    </button>
                  ))}
                </div>
                {hasAllDayEvents && (
                  <div className="cal-allday-row">
                    <div className="cal-gutter muted small">{t("calendar.allDay")}</div>
                    {timegridDays.map((day) => (
                      <div key={day.toISOString()} className="cal-allday-cell">
                        {eventsForDay(day)
                          .filter((ev) => ev.allDay)
                          .map((ev) => (
                            <button
                              type="button"
                              key={ev.id}
                              className={`cal-chip src-${ev.sourceType.toLowerCase()}${ev.sharedFrom ? " is-shared" : ""}`}
                              style={eventAccentStyle(ev)}
                              onClick={() => openEdit(ev)}
                            >
                              {ev.title}
                            </button>
                          ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="cal-timegrid-body">
                  <div className="cal-hours">
                    {HOURS.map((h) => (
                      <div key={h} className="cal-hour">
                        {String(h).padStart(2, "0")}:00
                      </div>
                    ))}
                  </div>
                  {(view === "week" ? weekDays : [cursor]).map((day) => (
                    <div key={day.toISOString()} className="cal-daycol">
                      {HOURS.map((h) => (
                        <button
                          type="button"
                          key={h}
                          className="cal-slot"
                          style={{ top: h * HOUR_PX }}
                          onClick={() => openCreate(day, h)}
                          aria-label={`${h}:00`}
                        />
                      ))}
                      {sameZonedDay(day, now, timeZone) && (
                        <div
                          className="cal-now-indicator"
                          style={{ top: zonedHourOffsetPx(now, timeZone, HOUR_PX) }}
                          aria-hidden
                        >
                          <span className="cal-now-dot" />
                          <span className="cal-now-line" />
                        </div>
                      )}
                      {layoutTimedEvents(eventsForDay(day), day, timeZone).map(({ ev, top, height, col, colCount }) => {
                          const timeLabel = formatEventTime(ev, i18n.language, timeZone);
                          const density = blockDensity(height);
                          const widthPct = 100 / colCount;
                          const gapPx = 2;
                          return (
                            <button
                              type="button"
                              key={ev.id}
                              className={`cal-block density-${density} src-${ev.sourceType.toLowerCase()}${ev.sharedFrom ? " is-shared" : ""}`}
                              style={{
                                top,
                                height,
                                left: `calc(${col * widthPct}% + ${gapPx}px)`,
                                width: `calc(${widthPct}% - ${gapPx * 2}px)`,
                                right: "auto",
                                ...eventAccentStyle(ev),
                              }}
                              onClick={() => openEdit(ev)}
                              title={`${ev.title}${timeLabel ? ` · ${timeLabel}` : ""}`}
                            >
                              {density === "xs" ? (
                                <strong className="cal-block-title">{ev.title}</strong>
                              ) : density === "sm" ? (
                                <strong className="cal-block-title">
                                  {ev.title}
                                  {timeLabel ? (
                                    <em className="cal-block-time-inline"> · {timeLabel}</em>
                                  ) : null}
                                </strong>
                              ) : (
                                <>
                                  <strong className="cal-block-title">{ev.title}</strong>
                                  {timeLabel ? <span className="cal-block-meta">{timeLabel}</span> : null}
                                </>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {draft && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <form
            className="modal panel"
            onClick={(e) => e.stopPropagation()}
            onSubmit={draft.readOnly ? (e) => e.preventDefault() : saveDraft}
          >
            <h2>{draft.readOnly ? t("calendar.sharedEvent") : draft.id ? t("calendar.edit") : t("calendar.new")}</h2>
            {draft.sharedFrom && (
              <p className="muted">
                {t("calendar.sharedFrom", { name: draft.sharedFrom.name || t("calendar.source.SHARED") })}
              </p>
            )}
            {!draft.id && !draft.readOnly && (
              <label className="field">
                <span>{t("calendar.layers.calendar")}</span>
                <select
                  value={draft.calendarId}
                  onChange={(e) => setDraft({ ...draft, calendarId: e.target.value })}
                  required
                >
                  <option value="">{t("calendar.layers.pickCalendar")}</option>
                  {jobLayers.length > 0 && (
                    <optgroup label={t("calendar.layers.jobs")}>
                      {jobLayers.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {profileLayers.length > 0 && (
                    <optgroup label={t("calendar.layers.profiles")}>
                      {profileLayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
            {draft.id && draft.calendarId && !draft.sharedFrom && (
              <p className="muted">
                {t("calendar.layers.onCalendar", {
                  name:
                    allEntityLayers.find((l) => l.id === draft.calendarId)?.name ??
                    t(`calendar.source.${draft.sourceType}`),
                })}
              </p>
            )}
            <label className="field">
              <span>{t("common.title")}</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                required
                autoFocus={!draft.readOnly}
                disabled={draft.readOnly}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })}
                disabled={draft.readOnly}
              />
              <span>{t("calendar.allDay")}</span>
            </label>
            {!draft.readOnly && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.alertEnabled}
                  onChange={(e) => setDraft({ ...draft, alertEnabled: e.target.checked })}
                />
                <span>{t("alerts.remindBefore")}</span>
              </label>
            )}
            {!draft.readOnly && draft.alertEnabled && (
              <label className="field">
                <span>{t("alerts.minutesBefore")}</span>
                <select
                  value={draft.remindMinutes}
                  onChange={(e) => setDraft({ ...draft, remindMinutes: Number(e.target.value) })}
                >
                  {[5, 10, 15, 30, 60, 120].map((m) => (
                    <option key={m} value={m}>
                      {t("alerts.minutesOption", { count: m })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div
              className="toolbar"
              style={{ padding: 0, boxShadow: "none", border: "none", background: "transparent" }}
            >
              <label className="field" style={{ flex: 1 }}>
                <span>{t("calendar.starts")}</span>
                <input
                  type={draft.allDay ? "date" : "datetime-local"}
                  value={draft.startsAt}
                  onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                  required
                  disabled={draft.readOnly}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>{t("calendar.ends")}</span>
                <input
                  type={draft.allDay ? "date" : "datetime-local"}
                  value={draft.endsAt}
                  onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                  required={!draft.allDay}
                  disabled={draft.readOnly}
                />
              </label>
            </div>
            <p className="muted small" translate="no">
              {timeZone.replace(/_/g, " ")}
            </p>
            <label className="field">
              <span>{t("common.notes")}</span>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                disabled={draft.readOnly}
              />
            </label>
            {!draft.id && !draft.readOnly && (
              <>
                <label className="field">
                  <span>{t("calendar.invitees")}</span>
                  <input
                    value={draft.attendees}
                    onChange={(e) => setDraft({ ...draft, attendees: e.target.value })}
                    placeholder={t("calendar.inviteesPlaceholder")}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  <span>{t("calendar.inviteVia")}</span>
                  <select
                    value={draft.inviteVia}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        inviteVia: e.target.value as Draft["inviteVia"],
                      })
                    }
                  >
                    <option value="AUTO">{t("calendar.inviteViaAuto")}</option>
                    <option value="GOOGLE">{t("calendar.inviteViaGoogle")}</option>
                    <option value="OUTLOOK">{t("calendar.inviteViaOutlook")}</option>
                    <option value="NONE">{t("calendar.inviteViaNone")}</option>
                  </select>
                </label>
              </>
            )}
            {draft.htmlLink && (
              <p className="muted small">
                <a href={draft.htmlLink} target="_blank" rel="noreferrer">
                  {t("calendar.openExternal")}
                </a>
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              {draft.id && !draft.readOnly && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void removeDraft()}
                >
                  {t("common.delete")}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </button>
              {!draft.readOnly && (
                <button className="btn primary" disabled={busy}>
                  {t("common.save")}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
