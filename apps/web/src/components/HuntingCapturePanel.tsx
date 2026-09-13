import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getToken } from "../api";
import { apiUrl } from "../config";

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!profileId) return null;

  async function onUploadFile(file: File) {
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
        }),
      );
      onSynced?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDownload() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const headers = new Headers();
      const token = getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const res = await fetch(apiUrl(`/api/v1/hunting/fetch/export-csv`), {
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = t("common.error");
        try {
          const body = JSON.parse(text) as { error?: { message?: string } };
          if (body.error?.message) msg = body.error.message;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || "jobs.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(t("hunting.capture.downloadDone"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel hunting-capture-io">
      <header className="hunting-panel-head">
        <h2>{t("hunting.capture.heading")}</h2>
      </header>
      <div className="toolbar">
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {t("hunting.capture.upload")}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void onDownload()}>
          {t("hunting.capture.download")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUploadFile(file);
          }}
        />
      </div>
      {message && <p className="muted small">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
