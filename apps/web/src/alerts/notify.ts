export type ToastTone = "info" | "success" | "warning" | "danger" | "schedule";

export type AlertToast = {
  id: string;
  eventId?: string;
  title: string;
  body: string;
  timeLabel: string;
  sourceType?: string;
  tone: ToastTone;
  createdAt: number;
  /** Auto-dismiss after ms; 0 = sticky */
  durationMs: number;
  actionLabel?: string;
  actionHref?: string;
  exiting?: boolean;
  paused?: boolean;
};

const FIRED_KEY = "worksphere_alert_fired";

export function alertFingerprint(eventId: string, startsAt: string, remindMinutes: number) {
  return `${eventId}|${startsAt}|${remindMinutes}`;
}

export function hasFiredAlert(fp: string) {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return Boolean(map[fp]);
  } catch {
    return false;
  }
}

export function markFiredAlert(fp: string) {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const now = Date.now();
    for (const [k, ts] of Object.entries(map)) {
      if (now - ts > 7 * 24 * 60 * 60 * 1000) delete map[k];
    }
    map[fp] = now;
    localStorage.setItem(FIRED_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

export function showSystemNotification(
  title: string,
  body: string,
  tag: string,
  href = "/calendar"
) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      silent: false,
      icon: "/logo.png",
    });
    n.onclick = () => {
      window.focus();
      n.close();
      if (!window.location.pathname.startsWith(href.split("?")[0] ?? href)) {
        window.location.assign(href);
      }
    };
  } catch {
    /* insecure context / blocked */
  }
}

export function toneForSource(sourceType?: string): ToastTone {
  if (sourceType === "JOB") return "schedule";
  if (sourceType === "HUNTING") return "info";
  if (sourceType === "TRANSACTION") return "success";
  return "warning";
}
