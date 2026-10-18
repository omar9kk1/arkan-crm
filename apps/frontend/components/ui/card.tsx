import type { ComponentPropsWithRef } from 'react';
import styles from './card.module.css';
export function Card({
  className = '',
  ...props
}: ComponentPropsWithRef<'section'>) {
  return <section className={`${styles.card} ${className}`} {...props} />;
}
