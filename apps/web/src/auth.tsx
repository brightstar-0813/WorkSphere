import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setToken, getToken, type AuthUser } from "./api";
import i18n from "./i18n";
import { DEFAULT_TIME_ZONE, resolveAppTimeZone } from "./lib/timezone";
import { disconnectChatSocket } from "./chat";

const TZ_KEY = "worksphere_timezone";

function cacheTimeZone(tz: string) {
  localStorage.setItem(TZ_KEY, tz);
}

function readCachedTimeZone() {
  return localStorage.getItem(TZ_KEY) || DEFAULT_TIME_ZONE;
}

async function ensureUserTimeZone(user: AuthUser, setUser: (u: AuthUser) => void) {
  const tz = resolveAppTimeZone(user.timeZone?.trim() || readCachedTimeZone());
  cacheTimeZone(tz);
  if (!user.timeZone?.trim() && getToken()) {
    try {
      const u = await api<AuthUser>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ timeZone: tz }),
      });
      setUser(u);
      return;
    } catch {
      /* keep local */
    }
  }
  if (user.timeZone?.trim()) cacheTimeZone(resolveAppTimeZone(user.timeZone));
}

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  applySession: (token: string, user: AuthUser) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setLocale: (locale: string) => Promise<void>;
  setTimeZone: (timeZone: string) => Promise<void>;
  updateProfile: (patch: { name?: string }) => Promise<void>;
  uploadAvatar: (dataUrl: string) => Promise<void>;
  removeAvatar: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<AuthUser>("/auth/me")
      .then(async (u) => {
        setUser(u);
        void i18n.changeLanguage(u.locale);
        localStorage.setItem("worksphere_locale", u.locale);
        await ensureUserTimeZone(u, setUser);
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setUser(data.user);
    void i18n.changeLanguage(data.user.locale);
    localStorage.setItem("worksphere_locale", data.user.locale);
    await ensureUserTimeZone(data.user, setUser);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const locale = localStorage.getItem("worksphere_locale") ?? "en";
    const timeZone = resolveAppTimeZone(readCachedTimeZone());
    const data = await api<{ token: string; user: AuthUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, locale, timeZone }),
    });
    setToken(data.token);
    setUser(data.user);
    cacheTimeZone(resolveAppTimeZone(data.user.timeZone || timeZone));
  }, []);

  const logout = useCallback(() => {
    disconnectChatSocket();
    setToken(null);
    setUser(null);
  }, []);

  const applySession = useCallback(async (token: string, nextUser: AuthUser) => {
    setToken(token);
    setUser(nextUser);
    void i18n.changeLanguage(nextUser.locale);
    localStorage.setItem("worksphere_locale", nextUser.locale);
    await ensureUserTimeZone(nextUser, setUser);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }, []);

  const setLocale = useCallback(async (locale: string) => {
    localStorage.setItem("worksphere_locale", locale);
    void i18n.changeLanguage(locale);
    if (getToken()) {
      const u = await api<AuthUser>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ locale }),
      });
      setUser(u);
    }
  }, []);

  const setTimeZone = useCallback(async (timeZone: string) => {
    cacheTimeZone(timeZone);
    if (getToken()) {
      const u = await api<AuthUser>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ timeZone }),
      });
      setUser(u);
    } else {
      setUser((prev) => (prev ? { ...prev, timeZone } : prev));
    }
  }, []);

  const updateProfile = useCallback(async (patch: { name?: string }) => {
    const u = await api<AuthUser>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setUser(u);
  }, []);

  const uploadAvatar = useCallback(async (dataUrl: string) => {
    const u = await api<AuthUser>("/auth/me/avatar", {
      method: "POST",
      body: JSON.stringify({ image: dataUrl }),
    });
    setUser(u);
  }, []);

  const removeAvatar = useCallback(async () => {
    const u = await api<AuthUser>("/auth/me/avatar", { method: "DELETE" });
    setUser(u);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      applySession,
      changePassword,
      setLocale,
      setTimeZone,
      updateProfile,
      uploadAvatar,
      removeAvatar,
    }),
    [
      user,
      loading,
      login,
      register,
      logout,
      applySession,
      changePassword,
      setLocale,
      setTimeZone,
      updateProfile,
      uploadAvatar,
      removeAvatar,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
