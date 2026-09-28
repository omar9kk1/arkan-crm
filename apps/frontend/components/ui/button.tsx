import type { ButtonHTMLAttributes } from 'react';
import styles from './button.module.css';
export function Button({
  className = '',
  variant = 'primary',
  compactOnMobile = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
  compactOnMobile?: boolean;
}) {
  return (
    <button
      className={`${styles.button} ${styles[variant]} ${compactOnMobile ? styles.compactOnMobile : ''} ${className}`}
      {...props}
    />
  );
}
