import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAlerts } from "../alerts/AlertProvider";
import { CalCollapse } from "./CalCollapse";

type Props = {
  onSynced?: () => void;
  /** Visible calendar range — used when syncing so new events in view are pulled. */
  syncRange?: { from: Date; to: Date };
};

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function CalendarIntegrations({ onSynced, syncRange }: Props) {
  const { t } = useTranslation();
  const { notify } = useAlerts();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [icsUrl, setIcsUrl] = useState("");
  const [icsLabel, setIcsLabel] = useState("");
  const [feedCount, setFeedCount] = useState(0);

  async function refreshCount() {
    try {
      const integ = await api<{ icsFeeds: unknown[] }>("/integrations/calendar");
      setFeedCount(integ.icsFeeds.length);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refreshCount();
  }, []);

  async function addIcs(e: FormEvent) {
    e.preventDefault();
    if (!icsUrl.trim()) return;
    setBusy(true);
    try {
      await api("/integrations/calendar/ics", {
        method: "POST",
        body: JSON.stringify({
          url: icsUrl.trim(),
          label:
            icsLabel.trim().length >= 2
              ? icsLabel.trim()
              : hostnameFromUrl(icsUrl.trim()) || undefined,
        }),
      });
      setIcsUrl("");
      setIcsLabel("");
      await refreshCount();
      onSynced?.();
      notify({
        title: t("calendar.ics.addedTitle"),
        body: t("calendar.ics.addedBody"),
        tone: "success",
      });
    } catch (err) {
      notify({
        title: t("calendar.ics.errorTitle"),
        body: err instanceof Error ? err.message : t("calendar.ics.errorBody"),
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      const padMs = 7 * 86400000;
      const from = syncRange
        ? new Date(syncRange.from.getTime() - padMs)
        : undefined;
      const to = syncRange
        ? new Date(syncRange.to.getTime() + padMs)
        : undefined;
      await api("/integrations/calendar/sync", {
        method: "POST",
        body: JSON.stringify({
          provider: "ALL",
          ...(from && to
            ? { from: from.toISOString(), to: to.toISOString() }
            : {}),
        }),
      });
      await refreshCount();
      onSynced?.();
      notify({
        title: t("calendar.integrations.syncedTitle"),
        body: t("calendar.ics.syncedBody"),
        tone: "success",
      });
    } catch (err) {
      notify({
        title: t("calendar.ics.errorTitle"),
        body: err instanceof Error ? err.message : t("calendar.ics.errorBody"),
        tone: "danger",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="cal-integrations">
      <CalCollapse
        title={t("calendar.ics.sectionTitle")}
        summary={
          feedCount > 0
            ? t("calendar.integrations.accountCount", { count: feedCount })
            : undefined
        }
        defaultOpen
      >
        <form className="cal-ics-form" onSubmit={(e) => void addIcs(e)}>
          <input
            type="url"
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            placeholder={t("calendar.ics.urlPlaceholder")}
            disabled={busy || syncing}
            required
            autoComplete="off"
          />
          <input
            type="text"
            value={icsLabel}
            onChange={(e) => setIcsLabel(e.target.value)}
            placeholder={t("calendar.ics.labelPlaceholder")}
            disabled={busy || syncing}
            autoComplete="off"
          />
          <button type="submit" className="btn primary" disabled={busy || syncing}>
            {t("calendar.ics.add")}
          </button>
        </form>
        {feedCount > 0 ? (
          <div className="cal-ics-actions" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn"
              disabled={busy || syncing}
              onClick={() => void syncAll()}
            >
              {syncing ? t("common.loading") : t("calendar.integrations.syncNow")}
            </button>
          </div>
        ) : null}
      </CalCollapse>
    </div>
  );
}
