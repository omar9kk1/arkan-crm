'use client';

import { Brand } from '../brand';
import { ManagerNavItem } from './manager-nav-item';
import { primaryNavigation, managerMoreNavigation } from './navigation';
import { useAuth } from '../../../features/auth/components/auth-provider';
import styles from './manager-shell.module.css';

export function ManagerSidebar() {
  const { user } = useAuth();
  const moreItems = managerMoreNavigation(user?.role);
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
        {moreItems.map((item) => (
          <ManagerNavItem key={item.id} item={item} />
        ))}
      </nav>
      <footer className={styles.sidebarFooter}>
        <span>الفرص لا تنتظر... بل نصنعها معا</span>
      </footer>
    </aside>
  );
}
