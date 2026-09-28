import type { InputHTMLAttributes } from 'react';
import { Icon } from './icon';
import styles from './search-bar.module.css';
export function SearchBar({
  label,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={`${styles.search} ${className}`}>
      <Icon name="search" />
      <input type="search" aria-label={label} {...props} />
    </label>
  );
}
