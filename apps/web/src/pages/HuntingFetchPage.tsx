import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiList } from "../api";
import { useAuth } from "../auth";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HuntingCapturePanel } from "../components/HuntingCapturePanel";
import {
  huntingProfileStorageKey,
  type HuntingProfile,
} from "../components/HuntingProfileSwitcher";
import { Pagination } from "../components/Pagination";

const PAGE_SIZE = 10;
const DOMAIN_LIST_ID = "hunting-fetch-domains";

type CapturedJob = {
  id: string;
  profileId: string;
  title: string;
  company: string;
  sourceUrl: string | null;
  salary: string;
  description: string;
  platform: string;
  status: string;
  capturedAt: string;
  user?: { id: string; name: string } | null;
  profile?: { id: string; name: string; userId: string } | null;
};

function findProfileByDomain(profiles: HuntingProfile[], domain: string) {
  const needle = domain.trim().toLowerCase();
  if (!needle) return null;
  return profiles.find((p) => p.name.trim().toLowerCase() === needle) ?? null;
}

function truncate(text: string, max = 80) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

export function HuntingFetchPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<HuntingProfile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [link, setLink] = useState("");
  const [salary, setSalary] = useState("");
  const [jd, setJd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [items, setItems] = useState<CapturedJob[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [confirmDeleteDomain, setConfirmDeleteDomain] = useState(false);

  const domainById = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.name])),
    [profiles],
  );
  const selectedDomainLabel =
    (profileId && domainById[profileId]) || domain.trim() || null;
  const matchedProfile = findProfileByDomain(profiles, domain);
  const canManageDomain = Boolean(
    profileId &&
      matchedProfile?.id === profileId &&
      user &&
      (user.role === "ADMIN" || matchedProfile.userId === user.id || !matchedProfile.userId),
  );

  const loadProfiles = useCallback(async () => {
    const data = await api<HuntingProfile[]>("/hunting/profiles?scope=all");
    setProfiles(data);
    return data;
  }, []);

  const selectDomain = useCallback(
    (nextDomain: string, nextProfileId: string | null, list?: HuntingProfile[]) => {
      const rows = list ?? profiles;
      setDomain(nextDomain);
      setProfileId(nextProfileId);
      if (user && nextProfileId) {
        localStorage.setItem(huntingProfileStorageKey(user.id), nextProfileId);
      }
      if (!nextProfileId && user) {
        const key = huntingProfileStorageKey(user.id);
        const still = rows.find((p) => p.id === localStorage.getItem(key));
        if (!still) localStorage.removeItem(key);
      }
    },
    [profiles, user],
  );

  useEffect(() => {
    if (!user) {
      setProfiles([]);
      setProfileId(null);
      setDomain("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadProfiles();
        if (cancelled) return;
        const key = huntingProfileStorageKey(user.id);
        const saved = localStorage.getItem(key);
        const savedMatch = saved ? data.find((p) => p.id === saved) : null;
        const active = data.find((p) => p.active) ?? data[0] ?? null;
        const selected = savedMatch ?? active;
        if (selected) {
          localStorage.setItem(key, selected.id);
          setProfileId(selected.id);
          setDomain(selected.name);
        } else {
          setProfileId(null);
          setDomain("");
        }
      } catch {
        if (!cancelled) {
          setProfileId(null);
          setDomain("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadProfiles]);

  function onDomainChange(value: string) {
    const match = findProfileByDomain(profiles, value);
    if (match) {
      selectDomain(match.name, match.id);
      return;
    }
    setDomain(value);
    if (!value.trim()) setProfileId(null);
  }

  const loadJobs = useCallback(async () => {
    if (!profileId) {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        profileId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const { data, meta } = await apiList<CapturedJob[]>(`/hunting/fetch?${params}`);
      setItems(data);
      setTotal(meta.total);
      setTotalPages(meta.totalPages);
      if (page > meta.totalPages && meta.totalPages > 0) setPage(meta.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [profileId, page, reloadToken, t]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    setPage(1);
  }, [profileId]);

  async function addDomain() {
    const name = domain.trim();
    if (!name) return;
    if (findProfileByDomain(profiles, name)) {
      const existing = findProfileByDomain(profiles, name)!;
      selectDomain(existing.name, existing.id);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await api<HuntingProfile>("/hunting/profiles", {
        method: "POST",
        body: JSON.stringify({ name, label: "", country: "" }),
      });
      const data = await loadProfiles();
      selectDomain(created.name, created.id, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function editDomain() {
    const name = domain.trim();
    if (!name || !profileId) return;
    const clash = findProfileByDomain(profiles, name);
    if (clash && clash.id !== profileId) {
      setError(t("hunting.fetch.domainExists"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await api<HuntingProfile>(`/hunting/profiles/${profileId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      const data = await loadProfiles();
      selectDomain(updated.name, updated.id, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function removeDomain() {
    if (!profileId) return;
    setSaving(true);
    setError("");
    try {
      await api(`/hunting/profiles/${profileId}`, { method: "DELETE" });
      setConfirmDeleteDomain(false);
      const data = await loadProfiles();
      const next = data.find((p) => p.active) ?? data[0] ?? null;
      selectDomain(next?.name ?? "", next?.id ?? null, data);
      setPage(1);
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      let resolvedId = profileId;
      const name = domain.trim();
      if (!resolvedId && name) {
        const existing = findProfileByDomain(profiles, name);
        if (existing) {
          resolvedId = existing.id;
          selectDomain(existing.name, existing.id);
        } else {
          const created = await api<HuntingProfile>("/hunting/profiles", {
            method: "POST",
            body: JSON.stringify({ name, label: "", country: "" }),
          });
          const data = await loadProfiles();
          selectDomain(created.name, created.id, data);
          resolvedId = created.id;
        }
      }
      if (!resolvedId) {
        setError(t("hunting.fetch.domainRequired"));
        return;
      }
      await api("/hunting/fetch", {
        method: "POST",
        body: JSON.stringify({
          profileId: resolvedId,
          title: title.trim(),
          company: company.trim(),
          sourceUrl: link.trim() || null,
          salary: salary.trim(),
          description: jd.trim(),
        }),
      });
      setTitle("");
      setCompany("");
      setLink("");
      setSalary("");
      setJd("");
      setManualOpen(false);
      setPage(1);
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function removeJob(id: string) {
    setSaving(true);
    setError("");
    try {
      await api(`/hunting/fetch/${id}`, { method: "DELETE" });
      setDeleteJobId(null);
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page hunting-page">
      <div className="page-header hunting-page-header">
        <div>
          <h1>{t("hunting.fetch.heading")}</h1>
          <p className="muted">{t("hunting.fetch.sharedHint")}</p>
        </div>
      </div>

      <HuntingCapturePanel
        profileId={profileId}
        onSynced={() => {
          setPage(1);
          setReloadToken((n) => n + 1);
        }}
      />

      <details
        className="hunting-sheet-panel hunting-manual-post panel"
        open={manualOpen}
        onToggle={(e) => setManualOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          <span>{t("hunting.fetch.manualHeading")}</span>
          {selectedDomainLabel ? (
            <span className="hunting-sheet-chip tone-neutral" translate="no">
              {selectedDomainLabel}
            </span>
          ) : null}
        </summary>

        <form className="hunting-manual-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="field hunting-domain-field">
            <span>{t("hunting.fetch.domain")}</span>
            <div className="hunting-domain-row">
              <input
                className="hunting-domain-input"
                value={domain}
                onChange={(e) => onDomainChange(e.target.value)}
                list={DOMAIN_LIST_ID}
                placeholder={t("hunting.fetch.domainPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                translate="no"
              />
              <datalist id={DOMAIN_LIST_ID}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              <div className="hunting-domain-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={saving || !domain.trim()}
                  onClick={() => void addDomain()}
                >
                  {t("common.add")}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={saving || !canManageDomain || !domain.trim()}
                  onClick={() => void editDomain()}
                >
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={saving || !canManageDomain}
                  onClick={() => setConfirmDeleteDomain(true)}
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </label>

          <div className="hunting-manual-grid">
            <label className="field">
              <span>{t("hunting.fetch.jobTitle")}</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("hunting.fetch.titlePlaceholder")}
                autoComplete="off"
                required
                disabled={saving}
              />
            </label>
            <label className="field">
              <span>{t("common.company")}</span>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t("hunting.fetch.companyPlaceholder")}
                autoComplete="organization"
                disabled={saving}
              />
            </label>
          </div>

          <div className="hunting-manual-grid">
            <label className="field">
              <span>{t("hunting.fetch.jdLink")}</span>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={t("hunting.fetch.urlPlaceholder")}
                inputMode="url"
                autoComplete="off"
                disabled={saving}
              />
            </label>
            <label className="field">
              <span>{t("hunting.fetch.salary")}</span>
              <input
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder={t("hunting.fetch.salaryPlaceholder")}
                autoComplete="off"
                disabled={saving}
              />
            </label>
          </div>

          <label className="field">
            <span>{t("hunting.fetch.jdLabel")}</span>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder={t("hunting.fetch.jdPlaceholder")}
              rows={6}
              disabled={saving}
            />
          </label>

          <div className="row-actions">
            <button
              className="btn primary"
              type="submit"
              disabled={saving || !title.trim() || !domain.trim()}
            >
              {saving ? t("common.saving") : t("hunting.fetch.post")}
            </button>
          </div>
        </form>
      </details>

      {error && <p className="form-error">{error}</p>}

      <div className="panel hunting-posted-jobs">
        <header className="hunting-panel-head">
          <h2>{t("hunting.fetch.postedHeading")}</h2>
          {selectedDomainLabel ? (
            <span className="muted small" translate="no">
              {selectedDomainLabel}
            </span>
          ) : null}
        </header>

        {loading && items.length === 0 ? (
          <p className="muted">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <p className="muted">{t("hunting.fetch.empty")}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table hunting-fetch-table">
              <thead>
                <tr>
                  <th>{t("hunting.fetch.domain")}</th>
                  <th>{t("hunting.fetch.title")}</th>
                  <th>{t("common.company")}</th>
                  <th>{t("hunting.fetch.link")}</th>
                  <th>{t("hunting.fetch.salary")}</th>
                  <th>{t("hunting.fetch.jd")}</th>
                  <th>{t("hunting.fetch.postedAt")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((job) => (
                  <tr key={job.id}>
                    <td translate="no">{domainById[job.profileId] || "—"}</td>
                    <td>
                      <strong>{job.title}</strong>
                    </td>
                    <td>{job.company || "—"}</td>
                    <td>
                      {job.sourceUrl ? (
                        <a
                          className="hunting-meta-link"
                          href={job.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("hunting.fetch.openLink")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{job.salary || "—"}</td>
                    <td className="hunting-fetch-jd" title={job.description || undefined}>
                      {job.description ? truncate(job.description) : "—"}
                    </td>
                    <td className="tabular muted">
                      <div>{new Date(job.capturedAt).toLocaleDateString(i18n.language)}</div>
                      {job.user?.name ? (
                        <div className="small">{t("hunting.fetch.postedBy", { name: job.user.name })}</div>
                      ) : null}
                    </td>
                    <td className="hunting-fetch-actions">
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setDeleteJobId(job.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          disabled={loading}
        />
      </div>

      <ConfirmDialog
        open={deleteJobId != null}
        title={t("hunting.fetch.deleteTitle")}
        body={t("hunting.fetch.confirmDelete")}
        danger
        busy={saving}
        onConfirm={() => {
          if (deleteJobId) void removeJob(deleteJobId);
        }}
        onCancel={() => setDeleteJobId(null)}
      />

      <ConfirmDialog
        open={confirmDeleteDomain}
        title={t("hunting.fetch.deleteDomainTitle")}
        body={t("hunting.fetch.confirmDeleteDomain", {
          name: selectedDomainLabel || "",
        })}
        danger
        busy={saving}
        onConfirm={() => void removeDomain()}
        onCancel={() => setConfirmDeleteDomain(false)}
      />
    </section>
  );
}
