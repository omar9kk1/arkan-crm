import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './settings.module.css';
export function SettingsField({
  label,
  children,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  children?: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children ?? <input {...props} />}
    </label>
  );
}
