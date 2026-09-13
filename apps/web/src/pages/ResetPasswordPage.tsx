import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type AuthUser } from "../api";
import { useAuth } from "../auth";
import { AlertBanner } from "../components/AlertBanner";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField } from "../components/PasswordField";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";
  const { user, applySession } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [validating, setValidating] = useState(Boolean(token));
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/jobs", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setValidating(false);
      return;
    }
    let cancelled = false;
    setValidating(true);
    api<{ valid: boolean; email: string }>(`/auth/reset-password/${encodeURIComponent(token)}`)
      .then((data) => {
        if (cancelled) return;
        setEmailHint(data.email);
        setInvalid(false);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string; user: AuthUser }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      await applySession(data.token, data.user);
      navigate("/jobs", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (validating) {
    return (
      <AuthLayout panelLead={t("auth.resetLead")}>
        <p className="muted" style={{ marginTop: "1rem" }}>
          {t("common.loading")}
        </p>
      </AuthLayout>
    );
  }

  if (invalid) {
    return (
      <AuthLayout panelLead={t("auth.resetLead")}>
        <div className="stack" style={{ marginTop: "1rem" }}>
          <AlertBanner tone="danger">{t("auth.resetInvalid")}</AlertBanner>
          <Link className="linkish" to="/forgot-password">
            {t("auth.requestNewLink")}
          </Link>
          <Link className="linkish" to="/login">
            {t("auth.backToLogin")}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout panelLead={t("auth.resetLead")}>
      <form onSubmit={(e) => void onSubmit(e)} className="stack" style={{ marginTop: "1rem" }}>
        {emailHint && (
          <label className="field">
            <span>{t("auth.email")}</span>
            <input value={emailHint} disabled />
          </label>
        )}
        <PasswordField
          label={t("auth.newPassword")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <PasswordField
          label={t("auth.confirmPassword")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
        {error && (
          <AlertBanner tone="danger" onDismiss={() => setError("")}>
            {error}
          </AlertBanner>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? t("common.saving") : t("auth.resetPassword")}
        </button>
      </form>
      <Link className="linkish" to="/login">
        {t("auth.backToLogin")}
      </Link>
    </AuthLayout>
  );
}
