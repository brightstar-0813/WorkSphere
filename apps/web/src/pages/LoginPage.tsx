import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertBanner } from "../components/AlertBanner";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../auth";

export function LoginPage() {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "register") {
      if (password !== confirm) {
        setError(t("auth.passwordMismatch"));
        return;
      }
      if (password.length < 6) {
        setError(t("auth.passwordTooShort"));
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await login(email, password);
      else await register(name || "User", email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setConfirm("");
  }

  return (
    <AuthLayout>
      <form onSubmit={(e) => void onSubmit(e)} className="stack" style={{ marginTop: "1rem" }}>
        {mode === "register" && (
          <label className="field">
            <span>{t("auth.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}
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
        <PasswordField
          label={t("auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "register" ? 6 : undefined}
          required
        />
        {mode === "register" && (
          <PasswordField
            label={t("auth.confirmPassword")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        )}
        {error && (
          <AlertBanner tone="danger" onDismiss={() => setError("")}>
            {error}
          </AlertBanner>
        )}
        <button className="btn primary" disabled={busy}>
          {mode === "login" ? t("auth.login") : t("auth.register")}
        </button>
      </form>

      {mode === "login" && (
        <Link className="linkish" to="/forgot-password">
          {t("auth.forgotPassword")}
        </Link>
      )}

      <button type="button" className="linkish" onClick={switchMode}>
        {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}
      </button>
    </AuthLayout>
  );
}
