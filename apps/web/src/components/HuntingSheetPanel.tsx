import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { StatusBadge, statusTone } from "./StatusBadge";
import type { HuntingProfile } from "./HuntingProfileSwitcher";

type Props = {
  profileId: string | null;
  onSynced?: () => void;
};

type SyncMeta = {
  bidsCreated: number;
  bidsUpdated: number;
  rowCount: number;
};

export function HuntingSheetPanel({ profileId, onSynced }: Props) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<HuntingProfile | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [sheetsWebAppUrl, setSheetsWebAppUrl] = useState("");
  const [sheetTabName, setSheetTabName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!profileId) {
      setProfile(null);
      return;
    }
    const list = await api<HuntingProfile[]>("/hunting/profiles");
    const row = list.find((p) => p.id === profileId) ?? null;
    setProfile(row);
    setSpreadsheetUrl(row?.spreadsheetUrl ?? "");
    setSheetsWebAppUrl(row?.sheetsWebAppUrl ?? "");
    setSheetTabName(row?.sheetTabName ?? row?.name ?? "");
  }, [profileId]);

  useEffect(() => {
    void load();
    setMessage("");
    setError("");
  }, [load]);

  if (!profileId) return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api<HuntingProfile>(`/hunting/profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({
          spreadsheetUrl: spreadsheetUrl.trim(),
          sheetsWebAppUrl: sheetsWebAppUrl.trim(),
          sheetTabName: sheetTabName.trim(),
        }),
      });
      setProfile(updated);
      setMessage(t("hunting.sheet.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onSync() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ profile: HuntingProfile; meta: SyncMeta }>(
        `/hunting/profiles/${profileId}/sheet/sync`,
        { method: "POST", body: "{}" },
      );
      setProfile(result.profile);
      setMessage(
        t("hunting.sheet.syncResult", {
          rows: result.meta.rowCount,
          bids: result.meta.bidsCreated + result.meta.bidsUpdated,
        }),
      );
      onSynced?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(spreadsheetUrl.trim() && sheetsWebAppUrl.trim());
  const configLabel = configured
    ? t("hunting.sheet.configured")
    : t("hunting.sheet.notConfigured");

  return (
    <details
      className="hunting-sheet-panel panel"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span>{t("hunting.sheet.heading")}</span>
        <StatusBadge tone={configured ? "success" : statusTone("DRAFT")}>{configLabel}</StatusBadge>
      </summary>
      <form className="hunting-sheet-form" onSubmit={(e) => void onSave(e)}>
        <label className="field">
          <span>{t("hunting.sheet.spreadsheetUrl")}</span>
          <input
            value={spreadsheetUrl}
            onChange={(e) => setSpreadsheetUrl(e.target.value)}
            placeholder={t("hunting.sheet.spreadsheetUrlPlaceholder")}
            inputMode="url"
            name="spreadsheetUrl"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>{t("hunting.sheet.webAppUrl")}</span>
          <input
            value={sheetsWebAppUrl}
            onChange={(e) => setSheetsWebAppUrl(e.target.value)}
            placeholder={t("hunting.sheet.webAppUrlPlaceholder")}
            inputMode="url"
            name="sheetsWebAppUrl"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>{t("hunting.sheet.tabName")}</span>
          <input
            value={sheetTabName}
            onChange={(e) => setSheetTabName(e.target.value)}
            placeholder={profile?.name || t("hunting.sheet.tabNamePlaceholder")}
            name="sheetTabName"
            autoComplete="off"
          />
        </label>
        <div className="row-actions">
          <button className="btn" type="submit" disabled={busy}>
            {t("common.save")}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || !configured}
            onClick={() => void onSync()}
          >
            {busy ? t("common.loading") : t("hunting.sheet.sync")}
          </button>
        </div>
      </form>
      {profile?.sheetSyncedAt && (
        <p className="muted small">
          {t("hunting.sheet.lastSync", { at: new Date(profile.sheetSyncedAt).toLocaleString() })}
        </p>
      )}
      {message && <p className="muted small hunting-sheet-msg">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </details>
  );
}
