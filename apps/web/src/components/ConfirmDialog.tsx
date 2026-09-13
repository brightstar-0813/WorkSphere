import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "./Logo";
import { ToastGlyph } from "../alerts/ToastGlyph";

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
  const titleId = useId();
  const bodyId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const tone = danger ? "danger" : "warning";

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-toast-stack" role="presentation">
      <div
        className={`toast-card confirm-toast tone-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
      >
        <span className="toast-rail" aria-hidden="true" />
        <div className="toast-glow" aria-hidden="true" />
        <header className="toast-head">
          <div className="toast-brand">
            <Logo size={16} />
            <span>{t("appName")}</span>
          </div>
          <span className={`toast-tone-chip tone-${tone}`}>
            {danger ? t("alerts.toneDanger") : t("alerts.toneWarning")}
          </span>
        </header>
        <div className="toast-body">
          <span className={`toast-mark tone-${tone}`} aria-hidden="true">
            <ToastGlyph tone={tone} />
          </span>
          <div className="toast-copy">
            <strong id={titleId} className="toast-title">
              {title}
            </strong>
            {body ? (
              <p id={bodyId} className="toast-text">
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
            ref={confirmRef}
            type="button"
            className={`toast-action${danger ? " is-danger" : ""}`}
            disabled={busy}
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
