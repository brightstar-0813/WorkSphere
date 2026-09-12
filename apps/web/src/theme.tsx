import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const THEMES = [
  { id: "aether", labelKey: "theme.aether" },
  { id: "midnight", labelKey: "theme.midnight" },
  { id: "copper", labelKey: "theme.copper" },
  { id: "arctic", labelKey: "theme.arctic" },
  { id: "volt", labelKey: "theme.volt" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const DARK_THEMES: ReadonlySet<ThemeId> = new Set(["midnight"]);

const STORAGE_KEY = "worksphere_theme";

type ThemeState = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = DARK_THEMES.has(theme) ? "dark" : "light";
}

function readStoredTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (THEMES.some((t) => t.id === stored)) return stored as ThemeId;
  return "aether";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
    applyTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside provider");
  return ctx;
}
