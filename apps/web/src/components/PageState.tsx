import { useTranslation } from "react-i18next";

type Props = {
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  emptyMessage?: string;
  className?: string;
};

/** Loading / empty / error strip for list pages. */
export function PageState({
  loading,
  empty,
  error,
  emptyMessage,
  className,
}: Props) {
  const { t } = useTranslation();
  if (error) {
    return <p className={`form-error${className ? ` ${className}` : ""}`}>{error}</p>;
  }
  if (loading) {
    return (
      <p className={`muted${className ? ` ${className}` : ""}`}>{t("common.loading")}</p>
    );
  }
  if (empty) {
    return (
      <p className={`muted${className ? ` ${className}` : ""}`}>
        {emptyMessage ?? t("common.empty")}
      </p>
    );
  }
  return null;
}
