import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../auth";
import { ConfirmDialog } from "./ConfirmDialog";

export type HuntingProfileIcsFeed = {
  id: string;
  label: string;
  color: string;
  url?: string;
};

export type HuntingProfile = {
  id: string;
  name: string;
  label: string;
  country: string;
  active: boolean;
  spreadsheetUrl?: string;
  sheetsWebAppUrl?: string;
  sheetTabName?: string;
  sheetSyncedAt?: string | null;
  captureBotUrl?: string;
  captureSyncedAt?: string | null;
  /** Linked imported calendar (if any) — same profile across bids / schedules / calendar */
  icsFeed?: HuntingProfileIcsFeed | null;
};

/** @deprecated ICS feeds are attached to profiles; kept for migration helpers */
export type IcsFeedOption = {
  id: string;
  label: string;
  url: string;
  color: string;
  profileId?: string | null;
  lastSyncAt: string | null;
};

export const ICS_PROFILE_PREFIX = "ics:";
export const ALL_PROFILES_ID = "all-profiles";

export function huntingProfileStorageKey(userId: string) {
  return `worksphere_hunting_profile_${userId}`;
}

export function isIcsProfileId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.startsWith(ICS_PROFILE_PREFIX);
}

export function isAllProfilesId(id: string | null | undefined): boolean {
  return id === ALL_PROFILES_ID;
}

export function isSpecialProfileId(id: string | null | undefined): boolean {
  return isIcsProfileId(id) || isAllProfilesId(id);
}

export function icsFeedIdFromProfileId(id: string) {
  return id.slice(ICS_PROFILE_PREFIX.length);
}

export function toIcsProfileId(feedId: string) {
  return `${ICS_PROFILE_PREFIX}${feedId}`;
}

/** Resolve any legacy `ics:` selection to a hunting profile id. */
export function huntingProfileIdFromSelection(
  profileId: string | null | undefined,
  profiles: HuntingProfile[] = [],
): string | null {
  if (!profileId || isAllProfilesId(profileId)) return null;
  if (isIcsProfileId(profileId)) {
    const feedId = icsFeedIdFromProfileId(profileId);
    const linked = profiles.find((p) => p.icsFeed?.id === feedId);
    return linked?.id ?? null;
  }
  return profileId;
}

function profileOptionLabel(p: HuntingProfile, inactiveLabel: string) {
  if (!p.active) return `${p.name} (${inactiveLabel})`;
  return p.name;
}

/** Limited country / market options for hunting profiles (full names) */
export const HUNTING_COUNTRIES = [
  "United States",
  "Philippines",
  "Brazil",
  "Canada",
  "United Kingdom",
  "Japan",
  "South Korea",
  "China",
  "Singapore",
  "Australia",
  "Germany",
  "India",
  "Mexico",
  "Remote",
] as const;

function migrateStoredProfileId(
  userId: string,
  profiles: HuntingProfile[],
): string | null {
  const key = huntingProfileStorageKey(userId);
  const legacyKey = `worksphere_interview_source_${userId}`;
  const saved = localStorage.getItem(key) || localStorage.getItem(legacyKey);
  if (!saved) return null;

  if (saved === ALL_PROFILES_ID) return ALL_PROFILES_ID;

  if (isIcsProfileId(saved)) {
    const feedId = icsFeedIdFromProfileId(saved);
    const linked = profiles.find((p) => p.icsFeed?.id === feedId);
    if (linked) {
      localStorage.setItem(key, linked.id);
      return linked.id;
    }
    return null;
  }

  if (profiles.some((p) => p.id === saved)) {
    localStorage.setItem(key, saved);
    return saved;
  }
  return null;
}

type Props = {
  profileId: string | null;
  onProfileIdChange: (id: string | null) => void;
  /**
   * @deprecated Profiles come from imported calendars. Prop kept for call-site compat.
   */
  includeImportedCalendars?: boolean;
  /** Notify parent when the profile list (with linked ICS) reloads */
  onProfilesLoaded?: (profiles: HuntingProfile[]) => void;
};

export function HuntingProfileSwitcher({
  profileId,
  onProfileIdChange,
  onProfilesLoaded,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<HuntingProfile[]>([]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api<HuntingProfile[]>("/hunting/profiles");
    setProfiles(data);
    onProfilesLoaded?.(data);
    return data;
  }, [onProfilesLoaded]);

  useEffect(() => {
    let cancelled = false;
    void load().then((data) => {
      if (cancelled || !user) return;
      const migrated = migrateStoredProfileId(user.id, data);
      const active = data.filter((p) => p.active);
      const resolved =
        migrated === ALL_PROFILES_ID
          ? ALL_PROFILES_ID
          : migrated || active[0]?.id || data[0]?.id || null;
      onProfileIdChange(resolved);
    });
    return () => {
      cancelled = true;
    };
    // Intentionally run once per user mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (user && profileId && !isIcsProfileId(profileId)) {
      localStorage.setItem(huntingProfileStorageKey(user.id), profileId);
    }
  }, [profileId, user]);

  async function onEdit(e: FormEvent) {
    e.preventDefault();
    if (!profileId || isSpecialProfileId(profileId) || !editName.trim()) return;
    setBusy(true);
    try {
      await api(`/hunting/profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          country: editCountry.trim(),
          // Clear legacy platform notes (e.g. auto-set "Calendar")
          label: "",
        }),
      });
      setEditing(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!profileId || isSpecialProfileId(profileId)) return;
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
    if (!profileId || isSpecialProfileId(profileId)) return;
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

  const selectedHunting =
    profileId && !isSpecialProfileId(profileId)
      ? profiles.find((p) => p.id === profileId)
      : undefined;
  const hasAny = profiles.length > 0;

  return (
    <div className="hunting-profile-bar panel">
      <div className="hunting-profile-main">
        <label className="field hunting-profile-select">
          <span>{t("hunting.profile.label")}</span>
          <select
            value={profileId && !isIcsProfileId(profileId) ? profileId : ""}
            onChange={(e) => {
              setEditing(false);
              onProfileIdChange(e.target.value || null);
            }}
            aria-label={t("hunting.profile.label")}
          >
            {!hasAny && <option value="">{t("hunting.profile.empty")}</option>}
            {hasAny && (
              <option value={ALL_PROFILES_ID}>{t("hunting.profile.allProfiles")}</option>
            )}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {profileOptionLabel(p, t("hunting.profile.inactive"))}
              </option>
            ))}
          </select>
        </label>

        {selectedHunting && (
          <div className="hunting-profile-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setEditName(selectedHunting.name);
                setEditCountry(selectedHunting.country ?? "");
                setEditing((v) => !v);
              }}
            >
              {editing ? t("common.cancel") : t("hunting.profile.edit")}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void toggleActive()}
            >
              {selectedHunting.active
                ? t("hunting.profile.deactivate")
                : t("hunting.profile.activate")}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>

      {editing && selectedHunting && (
        <form className="hunting-profile-form" onSubmit={(e) => void onEdit(e)}>
          <label className="field">
            <span>{t("hunting.profile.namePlaceholder")}</span>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>{t("hunting.profile.country")}</span>
            <select
              value={editCountry}
              onChange={(e) => setEditCountry(e.target.value)}
            >
              <option value="">{t("hunting.profile.noCountry")}</option>
              {HUNTING_COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
              {editCountry &&
                !HUNTING_COUNTRIES.includes(
                  editCountry as (typeof HUNTING_COUNTRIES)[number],
                ) && <option value={editCountry}>{editCountry}</option>}
            </select>
          </label>
          <div className="row-actions">
            <button className="btn primary" type="submit" disabled={busy || !editName.trim()}>
              {t("common.save")}
            </button>
            <button className="btn ghost" type="button" onClick={() => setEditing(false)}>
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
