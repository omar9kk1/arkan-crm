import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { UNAVAILABLE, type EmployeeRecord } from '../model';
import { EmployeeStats } from './employee-stats';
import styles from './employees.module.css';

export function EmployeeCard({
  employee,
  onDetails,
  onAssign,
}: {
  employee: EmployeeRecord;
  onDetails: () => void;
  /** OWNER-only existing action; a MANAGER's team view is read-only. */
  onAssign?: () => void;
}) {
  return (
    <Card className={styles.employeeCard} onClick={onDetails}>
      <div className={styles.profile}>
        <span className={styles.avatar} aria-hidden="true">
          {employee.name.slice(0, 1)}
        </span>
        <div>
          <h2>{employee.name}</h2>
          <p>{employee.roleLabel}</p>
          <p className={styles.muted}>
            المدير: {employee.managerName ?? 'مالك النظام'}
          </p>
          <bdi>{employee.phone || UNAVAILABLE}</bdi>
        </div>
        <span className={styles.badge}>
          {employee.active ? 'نشط' : 'غير نشط'}
        </span>
      </div>
      <EmployeeStats employee={employee} />
      <div className={styles.actions}>
        <Button
          onClick={(event) => {
            event.stopPropagation();
            onDetails();
          }}
          aria-label={`تفاصيل ${employee.name}`}
        >
          تفاصيل
        </Button>
        {onAssign && (
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onAssign();
            }}
            aria-label={`تخصيص عقار إلى ${employee.name}`}
          >
            تخصيص عقار
          </Button>
        )}
      </div>
    </Card>
  );
}
