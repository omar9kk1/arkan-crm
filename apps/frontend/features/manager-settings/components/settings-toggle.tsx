import styles from './settings.module.css';
export function SettingsToggle({
  label,
  defaultChecked = false,
  disabled = false,
}: {
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        role="switch"
        defaultChecked={defaultChecked}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}
