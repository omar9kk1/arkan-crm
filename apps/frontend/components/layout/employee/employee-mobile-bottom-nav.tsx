import { useState } from 'react';
import { PropertyOverlay } from '../../../features/manager-properties/components/property-overlay';
import { Icon } from '../../ui/icon';
import { EmployeeNavItem } from './employee-navigation';
import styles from '../manager/manager-shell.module.css';
export function EmployeeMobileBottomNav({
  onPreview,
}: {
  onPreview: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav className={styles.bottomNav} aria-label="تنقل الموظف على الهاتف">
        {[0, 1, 2, 3].map((index) => (
          <EmployeeNavItem key={index} index={index} onPreview={onPreview} />
        ))}
        <button
          className={styles.navItem}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon name="more" />
          <span>المزيد</span>
        </button>
      </nav>
      {open && (
        <PropertyOverlay
          title="المزيد"
          className={styles.compactMore}
          onClose={() => setOpen(false)}
        >
          <nav aria-label="أقسام الموظف الإضافية">
            {[4, 5].map((index) => (
              <EmployeeNavItem
                key={index}
                index={index}
                onNavigate={() => setOpen(false)}
                onPreview={(label) => {
                  setOpen(false);
                  onPreview(label);
                }}
              />
            ))}
          </nav>
        </PropertyOverlay>
      )}
    </>
  );
}
