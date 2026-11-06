import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { ComingSoon } from '../../../components/ui/coming-soon';

export default function Page() {
  return (
    <EmployeePageShell title="" description="">
      <ComingSoon
        icon="clock"
        title="الحضور والانصراف"
        message="قريبًا في الإصدار القادم"
        description="نعمل على تجهيز نظام الحضور والانصراف. ستتوفر هذه الميزة في إصدار قادم."
      />
    </EmployeePageShell>
  );
}
