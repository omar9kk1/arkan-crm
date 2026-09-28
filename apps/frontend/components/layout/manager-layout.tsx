import type { ReactNode } from 'react';
import { ManagerSidebar } from './manager/manager-sidebar';
import { ManagerTopbar } from './manager/manager-topbar';
import { ManagerMobileBottomNav } from './manager/manager-mobile-bottom-nav';
import styles from './manager/manager-shell.module.css';
import theme from '../../styles/manager-tokens.module.css';
export function ManagerLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.layout} ${theme.theme}`}>
      <a href="#manager-content" className={styles.skipLink}>
        تخطي إلى المحتوى
      </a>
      <ManagerSidebar />
      <div className={styles.content}>
        <ManagerTopbar />
        <main id="manager-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <ManagerMobileBottomNav />
    </div>
  );
}
