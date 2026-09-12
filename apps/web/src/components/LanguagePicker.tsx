import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth";

const LOCALES = [
  { code: "en", native: "English", short: "EN" },
  { code: "zh", native: "中文", short: "ZH" },
  { code: "ru", native: "Русский", short: "RU" },
] as const;

type LocaleCode = (typeof LOCALES)[number]["code"];

type Props = {
  className?: string;
  compact?: boolean;
};

function GlobeIcon() {
  return (
    <svg className="lang-picker-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.5 3.6 8.5s-1.2 5.9-3.6 8.5M12 3.5C9.6 6.1 8.4 9 8.4 12s1.2 5.9 3.6 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="lang-picker-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.2 8.4 6.1 11.3 12.8 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`lang-picker-chevron${open ? " open" : ""}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 6.2 8 10l4-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function resolveLocale(lang: string | undefined): LocaleCode {
  const raw = (lang ?? "en").slice(0, 2).toLowerCase();
  return LOCALES.some((l) => l.code === raw) ? (raw as LocaleCode) : "en";
}

export function LanguagePicker({ className = "", compact = true }: Props) {
  const { t, i18n } = useTranslation();
  const { setLocale } = useAuth();
  const value = resolveLocale(i18n.resolvedLanguage ?? i18n.language);
  const current = LOCALES.find((l) => l.code === value) ?? LOCALES[0];

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    LOCALES.findIndex((l) => l.code === value),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const close = useCallback(() => setOpen(false), []);

  const selectLocale = useCallback(
    (code: LocaleCode) => {
      void setLocale(code);
      setOpen(false);
    },
    [setLocale],
  );

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const idx = LOCALES.findIndex((l) => l.code === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    requestAnimationFrame(() => {
      const option = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      option?.focus();
    });
  }, [open, value]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % LOCALES.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + LOCALES.length) % LOCALES.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(LOCALES.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectLocale(LOCALES[activeIndex].code);
    } else if (e.key === "Tab") {
      close();
    }
  }

  useEffect(() => {
    if (!open) return;
    const option = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex];
    option?.focus();
  }, [activeIndex, open]);

  return (
    <div
      ref={rootRef}
      className={`lang-picker${compact ? " compact" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        className="lang-picker-trigger"
        aria-label={t("common.language")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <GlobeIcon />
        <span className="lang-picker-trigger-text">
          <span className="lang-picker-trigger-name">
            {compact ? current.short : current.native}
          </span>
          {!compact && <span className="lang-picker-trigger-code">{current.short}</span>}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          className="lang-picker-menu"
          role="listbox"
          aria-label={t("common.language")}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
        >
          <li className="lang-picker-menu-label" role="presentation">
            {t("common.language")}
          </li>
          {LOCALES.map((locale, index) => {
            const selected = locale.code === value;
            const active = index === activeIndex;
            return (
              <li key={locale.code} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`lang-picker-option${selected ? " selected" : ""}${active ? " active" : ""}`}
                  tabIndex={active ? 0 : -1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectLocale(locale.code)}
                >
                  <span className="lang-picker-option-main">
                    <span className="lang-picker-option-native">{locale.native}</span>
                    <span className="lang-picker-option-code">{locale.short}</span>
                  </span>
                  {selected && <CheckIcon />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
