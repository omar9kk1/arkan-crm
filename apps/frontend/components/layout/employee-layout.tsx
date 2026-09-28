'use client';
import { Toast } from '../ui/toast';

import { useState, type ReactNode } from 'react';
import { EmployeeSidebar } from './employee/employee-sidebar';
import { EmployeeTopbar } from './employee/employee-topbar';
import { EmployeeMobileBottomNav } from './employee/employee-mobile-bottom-nav';
import styles from './manager/manager-shell.module.css';
import theme from '../../styles/manager-tokens.module.css';
import local from './employee/employee.module.css';
export function EmployeeLayout({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState('');
  const preview = (label: string) =>
    setNotice(`${label} — معاينة فقط، سيتم تنفيذ الصفحة لاحقًا`);
  return (
    <div className={`${styles.layout} ${theme.theme} ${local.scope}`}>
      <a href="#employee-content" className={styles.skipLink}>
        تخطي إلى المحتوى
      </a>
      <EmployeeSidebar onPreview={preview} />
      <div className={styles.content}>
        <EmployeeTopbar onPreview={preview} />
        <main id="employee-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <EmployeeMobileBottomNav onPreview={preview} />
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </div>
  );
}
