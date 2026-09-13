import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ThemePicker } from "../ThemePicker";
import { AppFooter } from "./AppFooter";
import { GroupPriorityMark } from "./GroupPriorityMark";
import { LanguagePicker } from "./LanguagePicker";
import { Logo } from "./Logo";

export function AuthLayout({
  children,
  panelLead,
}: {
  children: ReactNode;
  panelLead?: string;
}) {
  const { t } = useTranslation();

  const priorityMark = (
    <GroupPriorityMark
      label={t("groupPriority.label")}
      message={t("groupPriority.message")}
      criterion={t("groupPriority.criterion")}
      priority={t("groupPriority.priority")}
    />
  );

  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        {priorityMark}
        <div className="topbar-actions">
          <LanguagePicker />
          <ThemePicker compact />
        </div>
      </header>

      <section className="auth-hero">
        <div>
          <div className="brand-mark">
            <Logo withWordmark wordmark={t("appName")} size={40} light />
          </div>
        </div>
        <div className="auth-metrics" aria-label={t("groupPriority.label")}>
          <div className="auth-metric is-lead">
            <strong translate="no">{t("groupPriority.label")}</strong>
            <span>{t("groupPriority.criterion")}</span>
          </div>
          <div className="auth-metric">
            <strong>{t("groupPriority.priorityCode")}</strong>
            <span>{t("groupPriority.priority")}</span>
          </div>
          <div className="auth-metric">
            <strong>{t("groupPriority.firstFilterCode")}</strong>
            <span>{t("groupPriority.firstFilter")}</span>
          </div>
        </div>
      </section>

      <section className="auth-side">
        <div className="auth-panel">
          <Logo withWordmark wordmark={t("appName")} size={36} />
          <p className="auth-panel-lead">{panelLead ?? t("groupPriority.heroLead")}</p>
          {children}
        </div>
      </section>

      <AppFooter />
    </div>
  );
}
