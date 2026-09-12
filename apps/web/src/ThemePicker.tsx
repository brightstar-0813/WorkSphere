import { useTranslation } from "react-i18next";
import { THEMES, useTheme, type ThemeId } from "./theme";

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div className={`theme-picker${compact ? " compact" : ""}`}>
      {!compact && <span className="theme-picker-label">{t("common.theme")}</span>}
      <div className="theme-swatches" role="radiogroup" aria-label={t("common.theme")}>
        {THEMES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={theme === item.id}
            className={`theme-swatch theme-swatch-${item.id}${theme === item.id ? " active" : ""}`}
            title={t(item.labelKey)}
            onClick={() => setTheme(item.id as ThemeId)}
          >
            <span className="swatch-core" />
            {!compact && <span className="swatch-name">{t(item.labelKey)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
