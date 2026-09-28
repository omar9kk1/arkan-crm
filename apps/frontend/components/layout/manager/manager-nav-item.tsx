'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '../../ui/icon';
import type { ManagerNavItem as NavItem } from './navigation';
import styles from './manager-shell.module.css';
export function ManagerNavItem({
  item,
  compact = false,
}: {
  item: NavItem;
  compact?: boolean;
}) {
  const active = usePathname() === item.href;
  const content = (
    <>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {!item.href && !compact && <small>قريبًا</small>}
    </>
  );
  return item.href ? (
    <Link
      className={`${styles.navItem} ${active ? styles.active : ''}`}
      href={item.href}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </Link>
  ) : (
    <button
      className={styles.navItem}
      type="button"
      disabled
      title={`${item.label} — قريبًا`}
      aria-label={`${item.label} — قريبًا`}
    >
      {content}
    </button>
  );
}
