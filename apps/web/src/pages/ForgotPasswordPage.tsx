import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { AlertBanner } from "../components/AlertBanner";
import { AuthLayout } from "../components/AuthLayout";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api<{ ok: boolean }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout panelLead={t("auth.forgotLead")}>
      {sent ? (
        <div className="stack" style={{ marginTop: "1rem" }}>
          <AlertBanner tone="success">{t("auth.forgotSent")}</AlertBanner>
          <Link className="linkish" to="/login">
            {t("auth.backToLogin")}
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={(e) => void onSubmit(e)} className="stack" style={{ marginTop: "1rem" }}>
            <label className="field">
              <span>{t("auth.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            {error && (
              <AlertBanner tone="danger" onDismiss={() => setError("")}>
                {error}
              </AlertBanner>
            )}
            <button className="btn primary" disabled={busy}>
              {busy ? t("common.saving") : t("auth.sendResetLink")}
            </button>
          </form>
          <Link className="linkish" to="/login">
            {t("auth.backToLogin")}
          </Link>
        </>
      )}
    </AuthLayout>
  );
}
