import type { ComponentPropsWithoutRef } from 'react';
import styles from './card.module.css';
export function Card({
  className = '',
  ...props
}: ComponentPropsWithoutRef<'section'>) {
  return <section className={`${styles.card} ${className}`} {...props} />;
}
