import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../auth";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusBadge } from "./StatusBadge";

export type HuntingProfile = {
  id: string;
  name: string;
  label: string;
  active: boolean;
  spreadsheetUrl?: string;
  sheetsWebAppUrl?: string;
  sheetTabName?: string;
  sheetSyncedAt?: string | null;
  captureBotUrl?: string;
  captureSyncedAt?: string | null;
};

const storageKey = (userId: string) => `worksphere_hunting_profile_${userId}`;

type Props = {
  profileId: string | null;
  onProfileIdChange: (id: string | null) => void;
};

export function HuntingProfileSwitcher({ profileId, onProfileIdChange }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<HuntingProfile[]>([]);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api<HuntingProfile[]>("/hunting/profiles");
    setProfiles(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((data) => {
      if (cancelled || !user) return;
      const saved = localStorage.getItem(storageKey(user.id));
      const active = data.filter((p) => p.active);
      const pick =
        (saved && data.find((p) => p.id === saved)?.id) ||
        active[0]?.id ||
        data[0]?.id ||
        null;
      onProfileIdChange(pick);
    });
    return () => {
      cancelled = true;
    };
    // Intentionally run once per user session mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (user && profileId) localStorage.setItem(storageKey(user.id), profileId);
  }, [profileId, user]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await api<HuntingProfile>("/hunting/profiles", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), label: label.trim() }),
      });
      setName("");
      setLabel("");
      setCreating(false);
      await load();
      onProfileIdChange(created.id);
    } finally {
      setBusy(false);
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!profileId || !renameValue.trim()) return;
    setBusy(true);
    try {
      await api(`/hunting/profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      setRenaming(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!profileId) return;
    const current = profiles.find((p) => p.id === profileId);
    if (!current) return;
    setBusy(true);
    try {
      await api(`/hunting/profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !current.active }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeActive() {
    if (!profileId) return;
    setBusy(true);
    try {
      await api(`/hunting/profiles/${profileId}`, { method: "DELETE" });
      setConfirmDelete(false);
      const data = await load();
      onProfileIdChange(data.filter((p) => p.active)[0]?.id ?? data[0]?.id ?? null);
    } finally {
      setBusy(false);
    }
  }

  const selected = profiles.find((p) => p.id === profileId);

  return (
    <div className="hunting-profile-bar panel">
      <div className="hunting-profile-main">
        <label className="field hunting-profile-select">
          <span>{t("hunting.profile.label")}</span>
          <select
            value={profileId ?? ""}
            onChange={(e) => {
              setRenaming(false);
              setCreating(false);
              onProfileIdChange(e.target.value || null);
            }}
            aria-label={t("hunting.profile.label")}
          >
            {profiles.length === 0 && <option value="">{t("hunting.profile.empty")}</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.label ? ` · ${p.label}` : ""}
                {!p.active ? ` (${t("hunting.profile.inactive")})` : ""}
              </option>
            ))}
          </select>
        </label>

        {selected && (
          <div className="hunting-profile-meta">
            {selected.label ? (
              <span className="muted small">{selected.label}</span>
            ) : (
              <span className="muted small">{t("hunting.profile.noLabel")}</span>
            )}
            <StatusBadge tone={selected.active ? "success" : "neutral"}>
              {selected.active ? t("hunting.profile.activeBadge") : t("hunting.profile.inactive")}
            </StatusBadge>
          </div>
        )}

        <div className="hunting-profile-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setCreating((v) => !v);
              setRenaming(false);
            }}
          >
            {creating ? t("common.cancel") : t("hunting.profile.add")}
          </button>
          {selected && (
            <>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setRenameValue(selected.name);
                  setRenaming((v) => !v);
                  setCreating(false);
                }}
              >
                {t("hunting.profile.rename")}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void toggleActive()}>
                {selected.active ? t("hunting.profile.deactivate") : t("hunting.profile.activate")}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                {t("common.delete")}
              </button>
            </>
          )}
        </div>
      </div>

      {creating && (
        <form className="hunting-profile-form" onSubmit={(e) => void onCreate(e)}>
          <label className="field">
            <span>{t("hunting.profile.namePlaceholder")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("hunting.profile.namePlaceholder")}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>{t("hunting.profile.labelPlaceholder")}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("hunting.profile.labelPlaceholder")}
            />
          </label>
          <div className="row-actions">
            <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
              {t("hunting.profile.create")}
            </button>
            <button className="btn ghost" type="button" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      {renaming && selected && (
        <form className="hunting-profile-form" onSubmit={(e) => void onRename(e)}>
          <label className="field">
            <span>{t("hunting.profile.renamePrompt")}</span>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              required
              autoFocus
            />
          </label>
          <div className="row-actions">
            <button className="btn primary" type="submit" disabled={busy || !renameValue.trim()}>
              {t("common.save")}
            </button>
            <button className="btn ghost" type="button" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("hunting.profile.deleteTitle")}
        body={t("hunting.profile.confirmDelete")}
        danger
        busy={busy}
        onConfirm={() => void removeActive()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
