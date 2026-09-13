import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, getToken } from "../api";
import type { CalEvent } from "../types/calendar";
import { Logo } from "../components/Logo";
import {
  alertFingerprint,
  ensureNotificationPermission,
  hasFiredAlert,
  markFiredAlert,
  showSystemNotification,
  toneForSource,
  type AlertToast,
  type ToastTone,
} from "./notify";
import { ToastGlyph } from "./ToastGlyph";
import { useAuth } from "../auth";
import {
  connectChatSocket,
  disconnectChatSocket,
  setChatNotifyHandler,
  shouldSuppressChatToast,
  type ChatNotifyPayload,
} from "../chat";

export type NotifyInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
  durationMs?: number;
  actionLabel?: string;
  actionHref?: string;
  eventId?: string;
  sourceType?: string;
};

type AlertState = {
  toasts: AlertToast[];
  permission: NotificationPermission | "unsupported" | "default";
  requestPermission: () => Promise<void>;
  notify: (input: NotifyInput) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

const AlertContext = createContext<AlertState | null>(null);
const POLL_MS = 20_000;
const MAX_TOASTS = 4;
const EXIT_MS = 280;

function toneLabelKey(tone: ToastTone) {
  if (tone === "success") return "alerts.toneSuccess";
  if (tone === "warning") return "alerts.toneWarning";
  if (tone === "danger") return "alerts.toneDanger";
  if (tone === "schedule") return "alerts.toneSchedule";
  return "alerts.toneInfo";
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "default">(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const timers = useRef<Map<string, number>>(new Map());
  const remaining = useRef<Map<string, number>>(new Map());
  const startedAt = useRef<Map<string, number>>(new Map());
  const paused = useRef<Set<string>>(new Set());
  const exiting = useRef<Set<string>>(new Set());

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      clearTimer(id);
      remaining.current.delete(id);
      startedAt.current.delete(id);
      paused.current.delete(id);
      exiting.current.delete(id);
      setToasts((list) => list.filter((x) => x.id !== id));
    },
    [clearTimer]
  );

  const dismiss = useCallback(
    (id: string) => {
      if (exiting.current.has(id)) return;
      clearTimer(id);
      exiting.current.add(id);
      setToasts((list) => list.map((x) => (x.id === id ? { ...x, exiting: true } : x)));
      window.setTimeout(() => removeToast(id), EXIT_MS);
    },
    [clearTimer, removeToast]
  );

  const dismissAll = useCallback(() => {
    setToasts((list) => {
      for (const toast of list) {
        if (exiting.current.has(toast.id)) continue;
        clearTimer(toast.id);
        exiting.current.add(toast.id);
        window.setTimeout(() => removeToast(toast.id), EXIT_MS);
      }
      return list.map((x) => (x.exiting ? x : { ...x, exiting: true }));
    });
  }, [clearTimer, removeToast]);

  const scheduleDismiss = useCallback(
    (id: string, durationMs: number) => {
      clearTimer(id);
      if (durationMs <= 0) return;
      remaining.current.set(id, durationMs);
      startedAt.current.set(id, Date.now());
      paused.current.delete(id);
      const handle = window.setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, handle);
    },
    [clearTimer, dismiss]
  );

  const pauseToast = useCallback(
    (id: string) => {
      if (paused.current.has(id) || exiting.current.has(id)) return;
      const left = remaining.current.get(id);
      const start = startedAt.current.get(id);
      if (left == null || start == null) return;
      const elapsed = Date.now() - start;
      remaining.current.set(id, Math.max(0, left - elapsed));
      clearTimer(id);
      paused.current.add(id);
      setToasts((list) => list.map((x) => (x.id === id ? { ...x, paused: true } : x)));
    },
    [clearTimer]
  );

  const resumeToast = useCallback(
    (id: string) => {
      if (!paused.current.has(id) || exiting.current.has(id)) return;
      const left = remaining.current.get(id) ?? 0;
      paused.current.delete(id);
      setToasts((list) => list.map((x) => (x.id === id ? { ...x, paused: false } : x)));
      if (left <= 0) {
        dismiss(id);
        return;
      }
      startedAt.current.set(id, Date.now());
      const handle = window.setTimeout(() => dismiss(id), left);
      timers.current.set(id, handle);
    },
    [dismiss]
  );

  const notify = useCallback(
    (input: NotifyInput) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const durationMs = input.durationMs ?? 6500;
      const toast: AlertToast = {
        id,
        eventId: input.eventId,
        title: input.title,
        body: input.body ?? "",
        timeLabel: new Date().toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }),
        sourceType: input.sourceType,
        tone: input.tone ?? "info",
        createdAt: Date.now(),
        durationMs,
        actionLabel: input.actionLabel,
        actionHref: input.actionHref,
      };
      setToasts((list) => {
        const without = input.eventId
          ? list.filter((x) => x.eventId !== input.eventId)
          : list;
        return [toast, ...without].slice(0, MAX_TOASTS);
      });
      scheduleDismiss(id, durationMs);
      return id;
    },
    [scheduleDismiss]
  );

  const requestPermission = useCallback(async () => {
    const next = await ensureNotificationPermission();
    setPermission(next === "unsupported" ? "unsupported" : next);
    if (next === "granted") {
      notify({
        title: t("alerts.enabledToastTitle"),
        body: t("alerts.enabledToastBody"),
        tone: "success",
        durationMs: 4500,
      });
    }
  }, [notify, t]);

  const scan = useCallback(async () => {
    if (!getToken() || !user) return;
    try {
      const events = await api<CalEvent[]>("/calendar/upcoming-alerts?horizonMinutes=720");
      const now = Date.now();
      for (const ev of events) {
        if (ev.alertEnabled === false) continue;
        const remind = ev.remindMinutes ?? 30;
        if (remind <= 0) continue;
        const start = new Date(ev.startsAt).getTime();
        const triggerAt = start - remind * 60 * 1000;
        if (now < triggerAt || now > start) continue;
        const fp = alertFingerprint(ev.id, ev.startsAt, remind);
        if (hasFiredAlert(fp)) continue;
        markFiredAlert(fp);

        const minsLeft = Math.max(1, Math.round((start - now) / 60000));
        const timeLabel = new Date().toLocaleTimeString(i18n.language, {
          hour: "numeric",
          minute: "2-digit",
        });
        const body = t("alerts.startsIn", { minutes: minsLeft });
        const id = `sched-${ev.id}-${Date.now()}`;
        const toast: AlertToast = {
          id,
          eventId: ev.id,
          title: ev.title,
          body,
          timeLabel,
          sourceType: ev.sourceType,
          tone: toneForSource(ev.sourceType),
          createdAt: Date.now(),
          durationMs: 12000,
          actionLabel: t("alerts.openCalendar"),
          actionHref: "/calendar",
        };
        setToasts((list) => {
          const without = list.filter((x) => x.eventId !== toast.eventId);
          return [toast, ...without].slice(0, MAX_TOASTS);
        });
        scheduleDismiss(id, toast.durationMs);
        showSystemNotification(t("alerts.systemTitle"), `${ev.title}\n${body}`, `ws-${ev.id}`);
      }
    } catch {
      /* offline / unauthorized */
    }
  }, [user, t, i18n.language, scheduleDismiss]);

  useEffect(() => {
    if (!user) return;
    void scan();
    const id = window.setInterval(() => void scan(), POLL_MS);
    const onFocus = () => void scan();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [user, scan]);

  useEffect(() => {
    if (!user) {
      setChatNotifyHandler(null);
      disconnectChatSocket();
      return;
    }

    connectChatSocket();
    setChatNotifyHandler((msg: ChatNotifyPayload) => {
      if (msg.author.id === user.id) return;
      if (shouldSuppressChatToast(msg.roomId)) return;

      const preview =
        msg.body.length > 140 ? `${msg.body.slice(0, 137).trimEnd()}…` : msg.body;
      const href = `/discuss?room=${encodeURIComponent(msg.roomId)}`;

      notify({
        title: t("discuss.toastMessageTitle", {
          name: msg.author.name,
          channel: msg.roomName || t("discuss.heading"),
        }),
        body: preview,
        tone: "info",
        durationMs: 8000,
        actionLabel: t("discuss.openChannel"),
        actionHref: href,
        eventId: `chat-${msg.id}`,
      });

      if (document.visibilityState === "hidden") {
        showSystemNotification(
          t("discuss.toastMessageTitle", {
            name: msg.author.name,
            channel: msg.roomName || t("discuss.heading"),
          }),
          preview,
          `ws-chat-${msg.roomId}`,
          href
        );
      }
    });

    return () => {
      setChatNotifyHandler(null);
    };
  }, [user, notify, t]);

  useEffect(() => {
    return () => {
      for (const handle of timers.current.values()) window.clearTimeout(handle);
      timers.current.clear();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="alertdialog"]')) return;
      const top = toasts.find((x) => !x.exiting);
      if (top) dismiss(top.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, toasts]);

  const value = useMemo(
    () => ({ toasts, permission, requestPermission, notify, dismiss, dismissAll }),
    [toasts, permission, requestPermission, notify, dismiss, dismissAll]
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      <AlertToaster onPause={pauseToast} onResume={resumeToast} />
    </AlertContext.Provider>
  );
}

function AlertToaster({
  onPause,
  onResume,
}: {
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const { t } = useTranslation();
  const ctx = useContext(AlertContext);
  if (!ctx || ctx.toasts.length === 0) return null;

  const visible = ctx.toasts.filter((x) => !x.exiting).length;

  return (
    <div
      className="toast-stack"
      role="region"
      aria-label={t("alerts.region")}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {ctx.toasts.map((toast, index) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          index={index}
          onDismiss={() => ctx.dismiss(toast.id)}
          onPause={() => onPause(toast.id)}
          onResume={() => onResume(toast.id)}
        />
      ))}
      {visible > 1 && (
        <button type="button" className="toast-clear-all" onClick={ctx.dismissAll}>
          {t("alerts.dismissAll")}
        </button>
      )}
    </div>
  );
}

function ToastCard({
  toast,
  index,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: AlertToast;
  index: number;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const { t } = useTranslation();
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <article
      className={`toast-card tone-${toast.tone}${toast.exiting ? " is-exiting" : ""}${
        toast.paused ? " is-paused" : ""
      }`}
      style={{ ["--toast-i" as string]: String(index) }}
      role="status"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
    >
      <span className="toast-rail" aria-hidden="true" />
      <div className="toast-glow" aria-hidden="true" />
      <header className="toast-head">
        <div className="toast-brand">
          <Logo size={16} />
          <span>{t("alerts.systemTitle")}</span>
        </div>
        <div className="toast-meta">
          <span className={`toast-tone-chip tone-${toast.tone}`}>{t(toneLabelKey(toast.tone))}</span>
          <span className="toast-time tabular">{toast.timeLabel}</span>
        </div>
      </header>

      <div className="toast-body">
        <div className={`toast-mark tone-${toast.tone}`} aria-hidden="true">
          <ToastGlyph tone={toast.tone} />
        </div>
        <div className="toast-copy">
          <strong className="toast-title">{toast.title}</strong>
          {toast.body ? <p className="toast-text">{toast.body}</p> : null}
          <div className="toast-actions">
            {toast.actionHref && toast.actionLabel ? (
              <Link className="toast-action" to={toast.actionHref} onClick={onDismiss}>
                {toast.actionLabel}
              </Link>
            ) : null}
            <button type="button" className="toast-dismiss" onClick={onDismiss}>
              {t("alerts.dismiss")}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="toast-close"
          aria-label={t("alerts.dismiss")}
          onClick={onDismiss}
        >
          ×
        </button>
      </div>

      {toast.durationMs > 0 && !reducedMotion && (
        <div className="toast-progress" aria-hidden="true">
          <span
            className={toast.paused ? "is-paused" : undefined}
            style={{ animationDuration: `${toast.durationMs}ms` }}
          />
        </div>
      )}
    </article>
  );
}

export function useAlerts() {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error("useAlerts outside provider");
  return ctx;
}
