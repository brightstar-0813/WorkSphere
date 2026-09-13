import { FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth";
import { AlertBanner } from "../components/AlertBanner";
import { PasswordField } from "../components/PasswordField";
import { TimezonePicker } from "../components/TimezonePicker";
import { mediaUrl } from "../config";
import { resolveAppTimeZone } from "../lib/timezone";

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, updateProfile, uploadAvatar, removeAvatar, setTimeZone, changePassword } =
    useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  async function onSaveName(e: FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next) return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      await updateProfile({ name: next });
      setOk(t("profile.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (newPassword.length < 6) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setBusy(true);
    setError("");
    setOk("");
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOk(t("profile.passwordChanged"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      setError(t("profile.avatarType"));
      return;
    }
    if (file.size > 1_800_000) {
      setError(t("profile.avatarTooLarge"));
      return;
    }
    setBusy(true);
    setError("");
    setOk("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      await uploadAvatar(dataUrl);
      setOk(t("profile.avatarUpdated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRemoveAvatar() {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await removeAvatar();
      setOk(t("profile.avatarRemoved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page profile-page">
      <header className="page-header">
        <div>
          <h1>{t("profile.heading")}</h1>
          <p className="muted">{user.email}</p>
        </div>
      </header>

      <div className="profile-grid">
        <article className="panel profile-avatar-card">
          <h2>{t("profile.avatar")}</h2>
          <div className="profile-avatar-preview">
            {user.avatarUrl ? (
              <img src={mediaUrl(user.avatarUrl)} alt="" className="profile-avatar-img" />
            ) : (
              <div className="user-avatar lg">{initialsOf(user.name)}</div>
            )}
          </div>
          <div className="profile-avatar-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {t("profile.uploadAvatar")}
            </button>
            {user.avatarUrl && (
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void onRemoveAvatar()}>
                {t("profile.removeAvatar")}
              </button>
            )}
          </div>
        </article>

        <article className="panel">
          <h2>{t("profile.account")}</h2>
          <form className="stack" onSubmit={(e) => void onSaveName(e)}>
            <label className="field">
              <span>{t("auth.name")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </label>
            <label className="field">
              <span>{t("auth.email")}</span>
              <input value={user.email} disabled />
            </label>
            <label className="field">
              <span>{t("common.role")}</span>
              <input value={user.role} disabled />
            </label>
            <div className="field">
              <span>{t("profile.timezone")}</span>
              <TimezonePicker
                value={resolveAppTimeZone(user.timeZone)}
                onChange={(tz) => void setTimeZone(tz)}
              />
            </div>
            <button className="btn primary" disabled={busy || !name.trim() || name.trim() === user.name}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </form>
        </article>

        <article className="panel">
          <h2>{t("profile.password")}</h2>
          <form className="stack" onSubmit={(e) => void onChangePassword(e)}>
            <PasswordField
              label={t("auth.currentPassword")}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <PasswordField
              label={t("auth.newPassword")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <PasswordField
              label={t("auth.confirmPassword")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <button
              className="btn primary"
              disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            >
              {busy ? t("common.saving") : t("profile.changePassword")}
            </button>
          </form>
        </article>
      </div>

      {error && (
        <AlertBanner tone="danger" onDismiss={() => setError("")}>
          {error}
        </AlertBanner>
      )}
      {ok && <p className="ok-msg">{ok}</p>}
    </section>
  );
}
