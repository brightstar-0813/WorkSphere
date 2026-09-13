import { useEffect, useRef } from "react";

type Props = {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

/** Accessible checkbox for row / select-all; supports indeterminate state. */
export function RowSelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
  className,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <label className={`row-select${className ? ` ${className}` : ""}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
      />
    </label>
  );
}
