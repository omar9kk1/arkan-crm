import { Brand } from '../brand';
import { ManagerNavItem } from './manager-nav-item';
import { primaryNavigation, moreNavigation } from './navigation';
import styles from './manager-shell.module.css';
export function ManagerSidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Brand />
        <p>إدارة العلاقات العقارية</p>
      </div>
      <nav aria-label="قائمة المدير" className={styles.sidebarNav}>
        <p className={styles.groupLabel}>مساحة العمل</p>
        {primaryNavigation.map((item) => (
          <ManagerNavItem key={item.id} item={item} />
        ))}
        <p className={styles.groupLabel}>الإدارة والمتابعة</p>
        {moreNavigation.map((item) => (
          <ManagerNavItem key={item.id} item={item} />
        ))}
      </nav>
      <footer className={styles.sidebarFooter}>
        <span className={styles.avatar}>م</span>
        <div>
          <strong>مساحة المدير</strong>
          <p>أركان الخليج العقارية • إدارة أعمالك بوضوح</p>
        </div>
      </footer>
    </aside>
  );
}
