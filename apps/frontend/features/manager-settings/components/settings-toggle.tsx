import styles from './settings.module.css';
export function SettingsToggle({
  label,
  description,
  defaultChecked = false,
  checked,
  disabled = false,
  busy = false,
  onChange,
}: {
  label: string;
  description?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        role="switch"
        {...(checked === undefined
          ? { defaultChecked }
          : { checked })}
        aria-checked={checked}
        aria-busy={busy || undefined}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>
        {label}
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}
