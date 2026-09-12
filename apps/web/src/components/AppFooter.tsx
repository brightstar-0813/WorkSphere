import { useTranslation } from "react-i18next";

export function AppFooter() {
  const { t } = useTranslation();
  return (
    <footer className="app-footer">
      <p>{t("common.footerCredit", { year: new Date().getFullYear() })}</p>
    </footer>
  );
}
