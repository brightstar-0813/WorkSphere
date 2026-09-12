import { apiUrl } from "./config";

export type AuthUser = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  name: string;
  locale: string;
  timeZone?: string;
  avatarUrl?: string | null;
};

export type ListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  countsByStatus?: Record<string, number>;
};

const TOKEN_KEY = "worksphere_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; meta?: ListMeta }> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(apiUrl(`/api/v1${path}`), { ...options, headers });
  if (res.status === 204) return { data: undefined as T };

  const text = await res.text();
  let body: { data?: T; meta?: ListMeta; error?: { message?: string } } | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as { data?: T; meta?: ListMeta; error?: { message?: string } };
    } catch {
      throw new Error(res.ok ? "Invalid response" : `Request failed (${res.status})`);
    }
  }
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return { data: body?.data as T, meta: body?.meta };
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await request<T>(path, options);
  return data;
}

export async function apiList<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; meta: ListMeta }> {
  const { data, meta } = await request<T>(path, options);
  return {
    data,
    meta:
      meta ?? {
        page: 1,
        pageSize: Array.isArray(data) ? data.length : 0,
        total: Array.isArray(data) ? data.length : 0,
        totalPages: 1,
      },
  };
}
