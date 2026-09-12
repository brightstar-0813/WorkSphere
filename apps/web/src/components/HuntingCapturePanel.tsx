import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { HuntingProfile } from "./HuntingProfileSwitcher";

type Props = {
  profileId: string | null;
  onSynced?: () => void;
};

type SyncMeta = {
  created: number;
  updated: number;
  skipped: number;
  total: number;
};

export function HuntingCapturePanel({ profileId, onSynced }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<HuntingProfile | null>(null);
  const [captureBotUrl, setCaptureBotUrl] = useState("http://127.0.0.1:3847");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    if (!profileId) {
      setProfile(null);
      return;
    }
    const list = await api<HuntingProfile[]>("/hunting/profiles");
    const row = list.find((p) => p.id === profileId) ?? null;
    setProfile(row);
    setCaptureBotUrl(row?.captureBotUrl || "http://127.0.0.1:3847");
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
        body: JSON.stringify({ captureBotUrl: captureBotUrl.trim() }),
      });
      setProfile(updated);
      setMessage(t("hunting.capture.saved"));
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
        `/hunting/profiles/${profileId}/capture/sync`,
        {
          method: "POST",
          body: JSON.stringify({ captureBotUrl: captureBotUrl.trim(), status: "new" }),
        }
      );
      setProfile(result.profile);
      setMessage(
        t("hunting.capture.syncResult", {
          total: result.meta.total,
          created: result.meta.created,
          updated: result.meta.updated,
        })
      );
      onSynced?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onImportFile(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const csv = await file.text();
      const result = await api<{ meta: SyncMeta }>(`/hunting/profiles/${profileId}/capture/import-csv`, {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      setMessage(
        t("hunting.capture.importResult", {
          total: result.meta.total,
          created: result.meta.created,
          updated: result.meta.updated,
        })
      );
      onSynced?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const configured = Boolean(captureBotUrl.trim());

  return (
    <details className="hunting-sheet-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("hunting.capture.heading")}</summary>
      <p className="muted small">{t("hunting.capture.hint")}</p>
      <form className="toolbar" onSubmit={(e) => void onSave(e)}>
        <input
          placeholder={t("hunting.capture.botUrl")}
          value={captureBotUrl}
          onChange={(e) => setCaptureBotUrl(e.target.value)}
          aria-label={t("hunting.capture.botUrl")}
        />
        <button className="btn" type="submit" disabled={busy}>
          {t("common.save")}
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={busy || !configured}
          onClick={() => void onSync()}
        >
          {t("hunting.capture.sync")}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {t("hunting.capture.importCsv")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
          }}
        />
      </form>
      {profile?.captureSyncedAt && (
        <p className="muted small">
          {t("hunting.capture.lastSync", { at: new Date(profile.captureSyncedAt).toLocaleString() })}
        </p>
      )}
      {message && <p className="muted small">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </details>
  );
}
