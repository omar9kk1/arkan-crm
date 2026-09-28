import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import type { EmployeeSample } from '../mock-data';
import { EmployeeStats } from './employee-stats';
import styles from './employees.module.css';
export function EmployeeCard({
  employee,
  assignedCount,
  onDetails,
  onAssign,
}: {
  employee: EmployeeSample;
  assignedCount: number;
  onDetails: () => void;
  onAssign: () => void;
}) {
  return (
    <Card className={styles.employeeCard} onClick={onDetails}>
      <div className={styles.profile}>
        <span className={styles.avatar} aria-hidden="true">
          {employee.name.slice(0, 1)}
        </span>
        <div>
          <h2>{employee.name}</h2>
          <p>{employee.jobRole || 'موظف مبيعات'}</p>
          <bdi>{employee.phone}</bdi>
        </div>
        <span className={styles.badge}>
          {employee.active ? 'نشط' : 'غير نشط'}
        </span>
      </div>
      <EmployeeStats employee={employee} assignedCount={assignedCount} />
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
        <Button
          onClick={(event) => {
            event.stopPropagation();
            onAssign();
          }}
          aria-label={`تخصيص عقار إلى ${employee.name}`}
        >
          تخصيص عقار
        </Button>
      </div>
    </Card>
  );
}
