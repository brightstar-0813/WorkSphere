import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="confirm-toast-stack" role="region" aria-label={title}>
      <div
        className={`toast-card confirm-toast${danger ? " tone-danger" : " tone-warning"}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-toast-title"
        aria-describedby={body ? "confirm-toast-body" : undefined}
      >
        <div className="toast-glow" aria-hidden="true" />
        <div className="toast-head">
          <span className="toast-brand">{t("appName")}</span>
        </div>
        <div className="toast-body">
          <span className={`toast-mark${danger ? " tone-danger" : ""}`} aria-hidden="true" />
          <div className="toast-copy">
            <strong id="confirm-toast-title" className="toast-title">
              {title}
            </strong>
            {body ? (
              <p id="confirm-toast-body" className="toast-text">
                {body}
              </p>
            ) : null}
          </div>
        </div>
        <div className="toast-actions confirm-toast-actions">
          <button
            type="button"
            className="toast-dismiss"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            className={`toast-action${danger ? " is-danger" : ""}`}
            disabled={busy}
            autoFocus
            onClick={onConfirm}
          >
            {busy ? t("common.loading") : confirmLabel ?? t("common.delete")}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="confirm-toast-scrim"
        aria-label={t("common.cancel")}
        disabled={busy}
        onClick={onCancel}
      />
    </div>
  );
}
