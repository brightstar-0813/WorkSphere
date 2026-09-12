import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ThemePicker } from "../ThemePicker";
import { AppFooter } from "../components/AppFooter";
import { LanguagePicker } from "../components/LanguagePicker";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth";

export function LoginPage() {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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

  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <div className="topbar-title">
          <span className="topbar-kicker">{t("appName")}</span>
          <strong>{mode === "login" ? t("auth.login") : t("auth.register")}</strong>
        </div>
        <div className="topbar-actions">
          <LanguagePicker />
          <ThemePicker compact />
        </div>
      </header>

      <section className="auth-hero">
        <div>
          <div className="brand-mark">
            <Logo withWordmark wordmark={t("appName")} size={40} light />
          </div>
        </div>
      </section>

      <section className="auth-side">
        <div className="auth-panel">
          <Logo withWordmark wordmark={t("appName")} size={36} />

          <form onSubmit={onSubmit} className="stack" style={{ marginTop: "1rem" }}>
            {mode === "register" && (
              <label className="field">
                <span>{t("auth.name")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label className="field">
              <span>{t("auth.email")}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span>{t("auth.password")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              {mode === "login" ? t("auth.login") : t("auth.register")}
            </button>
          </form>
          <button
            type="button"
            className="linkish"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}
          </button>
        </div>
      </section>

      <AppFooter />
    </div>
  );
}
