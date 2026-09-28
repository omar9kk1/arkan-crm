import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '../../ui/icon';
import styles from '../manager/manager-shell.module.css';
export const employeeNavigation: { label: string; icon: IconName }[] = [
  { label: 'الرئيسية', icon: 'home' },
  { label: 'العملاء', icon: 'users' },
  { label: 'العقارات', icon: 'building' },
  { label: 'المتابعات', icon: 'clock' },
  { label: 'الإشعارات', icon: 'bell' },
  { label: 'الحضور', icon: 'clock' },
];
export function EmployeeNavItem({
  index,
  onPreview,
  onNavigate,
}: {
  index: number;
  onPreview: (label: string) => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const item = employeeNavigation[index];
  if (!item) return null;
  const href =
    index === 0
      ? '/employee'
      : index === 1
        ? '/employee/clients'
        : index === 2
          ? '/employee/properties'
          : index === 3
            ? '/employee/followups'
            : index === 4
              ? '/employee/notifications'
              : index === 5
                ? '/employee/attendance'
                : undefined;
  if (href)
    return (
      <Link
        href={href}
        onNavigate={onNavigate}
        className={styles.navItem}
        aria-current={pathname === href ? 'page' : undefined}
      >
        <Icon name={item.icon} />
        <span>{item.label}</span>
      </Link>
    );
  return (
    <button
      type="button"
      className={styles.navItem}
      aria-current={index === 0 ? 'page' : undefined}
      onClick={() =>
        index === 0
          ? window.scrollTo({ top: 0, behavior: 'smooth' })
          : onPreview(item.label)
      }
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </button>
  );
}
