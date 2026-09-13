import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ToastGlyph } from "../alerts/ToastGlyph";
import type { ToastTone } from "../alerts/notify";

type BannerTone = Exclude<ToastTone, "schedule"> | "schedule";

type Props = {
  tone?: BannerTone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

export function AlertBanner({
  tone = "danger",
  title,
  children,
  onDismiss,
  className = "",
}: Props) {
  const { t } = useTranslation();

  return (
    <div
      className={`alert-banner tone-${tone}${className ? ` ${className}` : ""}`}
      role="alert"
      aria-live="polite"
    >
      <span className="alert-banner-rail" aria-hidden="true" />
      <span className="alert-banner-icon" aria-hidden="true">
        <ToastGlyph tone={tone} />
      </span>
      <div className="alert-banner-copy">
        {title ? <strong className="alert-banner-title">{title}</strong> : null}
        <div className="alert-banner-body">{children}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="alert-banner-close"
          aria-label={t("alerts.dismiss")}
          onClick={onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
