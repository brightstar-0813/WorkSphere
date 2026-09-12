import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { apiUrl } from "../config";

type InviteInfo = {
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  ownerEmail: string;
  requester: { id: string; email: string; name: string };
  googleConfigured: boolean;
  outlookConfigured: boolean;
};

async function publicApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(apiUrl(`/api/v1${path}`), { ...options, headers });
  const text = await res.text();
  let body: { data?: T; error?: { message?: string } } | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as { data?: T; error?: { message?: string } };
    } catch {
      throw new Error(res.ok ? "Invalid response" : `Request failed (${res.status})`);
    }
  }
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body?.data as T;
}

export function ShareAcceptPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [icsUrl, setIcsUrl] = useState("");
  const statusParam = params.get("status");
  const messageParam = params.get("message");

  useEffect(() => {
    if (!token) return;
    void publicApi<InviteInfo>(`/calendar/shares/invite/${token}`)
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : t("calendar.shareInvite.invalid")));
  }, [token, t]);

  async function startOAuth(provider: "GOOGLE" | "OUTLOOK") {
    setBusy(true);
    setError("");
    try {
      const data = await publicApi<{ url: string }>(
        `/calendar/shares/invite/${token}/oauth/${provider.toLowerCase()}`
      );
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("calendar.shareInvite.error"));
      setBusy(false);
    }
  }

  async function acceptWithIcs(e: FormEvent) {
    e.preventDefault();
    if (!icsUrl.trim()) return;
    setBusy(true);
    setError("");
    try {
      await publicApi(`/calendar/shares/invite/${token}/accept-ics`, {
        method: "POST",
        body: JSON.stringify({ url: icsUrl.trim() }),
      });
      setInfo((s) => (s ? { ...s, status: "ACCEPTED" } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("calendar.shareInvite.error"));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    setError("");
    try {
      await publicApi(`/calendar/shares/invite/${token}/decline`, { method: "POST" });
      setInfo((s) => (s ? { ...s, status: "DECLINED" } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("calendar.shareInvite.error"));
    } finally {
      setBusy(false);
    }
  }

  const doneAccepted = statusParam === "accepted" || info?.status === "ACCEPTED";
  const doneDeclined = info?.status === "DECLINED";
  const oauthError = statusParam === "error";
  const showIcsFallback = Boolean(info && !info.googleConfigured);

  return (
    <div className="share-accept-page">
      <div className="share-accept-card panel">
        <Logo withWordmark wordmark={t("appName")} size={36} />
        <h1>{t("calendar.shareInvite.heading")}</h1>

        {error && <p className="error">{error}</p>}
        {oauthError && (
          <p className="error">
            {messageParam ? decodeURIComponent(messageParam) : t("calendar.shareInvite.oauthError")}
          </p>
        )}

        {!info && !error ? <p className="muted">{t("common.loading")}</p> : null}

        {info && doneAccepted && (
          <>
            <p className="share-accept-ok">{t("calendar.shareInvite.acceptedTitle")}</p>
            <p className="muted">{t("calendar.shareInvite.acceptedBody")}</p>
          </>
        )}

        {info && doneDeclined && !doneAccepted && (
          <>
            <p>{t("calendar.shareInvite.declinedTitle")}</p>
            <p className="muted">{t("calendar.shareInvite.declinedBody")}</p>
          </>
        )}

        {info && info.status === "PENDING" && !doneAccepted && (
          <>
            <p>
              {t("calendar.shareInvite.from", {
                name: info.requester.name,
                email: info.requester.email,
              })}
            </p>
            <div className="share-accept-actions">
              {info.googleConfigured ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void startOAuth("GOOGLE")}
                >
                  {t("calendar.shareInvite.acceptGoogle")}
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void decline()}
              >
                {t("calendar.share.decline")}
              </button>
            </div>

            {showIcsFallback ? (
              <form className="share-accept-ics" onSubmit={(e) => void acceptWithIcs(e)}>
                <p className="muted small">{t("calendar.shareInvite.icsHint", { email: info.ownerEmail })}</p>
                <input
                  type="url"
                  value={icsUrl}
                  onChange={(e) => setIcsUrl(e.target.value)}
                  placeholder={t("calendar.shareInvite.icsPlaceholder")}
                  disabled={busy}
                  required
                />
                <button type="submit" className="btn primary" disabled={busy || !icsUrl.trim()}>
                  {t("calendar.shareInvite.acceptIcs")}
                </button>
              </form>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
