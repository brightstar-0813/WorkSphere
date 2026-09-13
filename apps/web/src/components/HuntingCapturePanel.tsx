import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getToken } from "../api";
import { useAuth } from "../auth";
import { apiUrl } from "../config";
import { resolveAppTimeZone } from "../lib/timezone";
import { ConfirmDialog } from "./ConfirmDialog";

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

type FileStatus = {
  jobCount: number;
  fileName: string | null;
  uploadedAt: string | null;
  uploadedBy: { id: string; name: string } | null;
  lastUpdatedAt: string | null;
};

export function HuntingCapturePanel({ profileId, onSynced }: Props) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const timeZone = resolveAppTimeZone(user?.timeZone);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<FileStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const data = await api<FileStatus>("/hunting/fetch/file-status");
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  if (!profileId) return null;

  function formatWhen(iso: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleString(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    });
  }

  async function onUploadFile(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const csv = await file.text();
      const result = await api<{ meta: SyncMeta }>(`/hunting/profiles/${profileId}/capture/import-csv`, {
        method: "POST",
        body: JSON.stringify({ csv, fileName: file.name }),
      });
      setMessage(
        t("hunting.capture.importResult", {
          total: result.meta.total,
          created: result.meta.created,
          updated: result.meta.updated,
        }),
      );
      await loadStatus();
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
      const filename = match?.[1] || status?.fileName || "jobs.csv";
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

  async function onDeleteAll() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ deleted: number }>("/hunting/fetch", { method: "DELETE" });
      setConfirmDelete(false);
      setMessage(t("hunting.capture.deleteDone", { count: result.deleted }));
      await loadStatus();
      onSynced?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const hasJobs = (status?.jobCount ?? 0) > 0;
  const whenLabel = formatWhen(status?.uploadedAt ?? status?.lastUpdatedAt ?? null);

  return (
    <div className="panel hunting-capture-io">
      <header className="hunting-panel-head">
        <h2>{t("hunting.capture.heading")}</h2>
        <p className="muted small">{t("hunting.capture.sharedHint")}</p>
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
        <button
          className="btn"
          type="button"
          disabled={busy || !hasJobs}
          onClick={() => void onDownload()}
        >
          {t("hunting.capture.download")}
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy || !hasJobs}
          onClick={() => setConfirmDelete(true)}
        >
          {t("hunting.capture.delete")}
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
      <div className="hunting-capture-status" aria-live="polite">
        {statusLoading ? (
          <p className="muted small">{t("common.loading")}</p>
        ) : hasJobs ? (
          <p className="muted small hunting-capture-status-line">
            <span className="hunting-sheet-chip tone-success">
              {t("hunting.capture.statusReady")}
            </span>
            {status?.fileName ? (
              <span className="hunting-capture-file" translate="no">
                {status.fileName}
              </span>
            ) : null}
            <span>
              {t("hunting.capture.statusJobs", { count: status?.jobCount ?? 0 })}
            </span>
            {whenLabel ? (
              <span>
                {status?.uploadedAt
                  ? t("hunting.capture.statusUploadedAt", { when: whenLabel })
                  : t("hunting.capture.statusUpdatedAt", { when: whenLabel })}
              </span>
            ) : null}
            {status?.uploadedBy?.name ? (
              <span>
                {t("hunting.capture.statusBy", { name: status.uploadedBy.name })}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="muted small">{t("hunting.capture.statusEmpty")}</p>
        )}
      </div>
      {message && <p className="muted small">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      <ConfirmDialog
        open={confirmDelete}
        title={t("hunting.capture.deleteTitle")}
        body={t("hunting.capture.confirmDelete", { count: status?.jobCount ?? 0 })}
        danger
        busy={busy}
        onConfirm={() => void onDeleteAll()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
