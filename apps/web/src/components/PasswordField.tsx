import { useId, useState, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  /** When true, wraps in a `<label className="field">`. Default true. */
  withLabel?: boolean;
};

export function PasswordField({
  label,
  withLabel = true,
  id,
  className,
  disabled,
  ...inputProps
}: PasswordFieldProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const inputId = id ?? autoId;
  const [visible, setVisible] = useState(false);

  const control = (
    <div className={`password-field${className ? ` ${className}` : ""}`}>
      <input
        {...inputProps}
        id={inputId}
        type={visible ? "text" : "password"}
        disabled={disabled}
        autoComplete={inputProps.autoComplete ?? "current-password"}
      />
      <button
        type="button"
        className="password-toggle"
        disabled={disabled}
        aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? t("auth.hidePassword") : t("auth.showPassword")}
      </button>
    </div>
  );

  if (!withLabel) return control;

  return (
    <label className="field" htmlFor={inputId}>
      <span>{label}</span>
      {control}
    </label>
  );
}
