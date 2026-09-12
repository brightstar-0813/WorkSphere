/** Empty in local Vite (proxy). Set VITE_API_URL in production (e.g. Render API origin). */
export const API_BASE = String(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

/** Resolve `/uploads/...` (and other API-hosted paths) for <img src>. */
export function mediaUrl(path: string | null | undefined) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return apiUrl(path);
}
