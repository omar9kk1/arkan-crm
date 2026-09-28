import { Brand } from '../brand';
import { employeeNavigation, EmployeeNavItem } from './employee-navigation';
import styles from '../manager/manager-shell.module.css';
export function EmployeeSidebar({
  onPreview,
}: {
  onPreview: (label: string) => void;
}) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Brand />
        <p>مساحة الموظف</p>
      </div>
      <nav className={styles.sidebarNav} aria-label="تنقل الموظف">
        {employeeNavigation.map((item, index) => (
          <EmployeeNavItem
            key={item.label}
            index={index}
            onPreview={onPreview}
          />
        ))}
      </nav>
      <div className={styles.sidebarFooter}>أدوات العمل اليومي — معاينة</div>
    </aside>
  );
}
