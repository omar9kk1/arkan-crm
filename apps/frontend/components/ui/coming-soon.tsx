import { Icon, type IconName } from './icon';
import styles from './coming-soon.module.css';

export function ComingSoon({
  icon = 'megaphone',
  title,
  message,
  description,
  badge = 'قيد التطوير',
}: {
  icon?: IconName;
  title: string;
  message: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className={styles.wrap}>
      <span className={styles.icon} aria-hidden="true">
        <Icon name={icon} width={32} height={32} />
      </span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.message}>{message}</p>
      <p className={styles.desc}>{description}</p>
      <span className={styles.badge}>{badge}</span>
    </div>
  );
}
