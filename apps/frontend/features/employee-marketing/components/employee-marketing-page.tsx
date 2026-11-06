import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { ComingSoon } from '../../../components/ui/coming-soon';

export default function EmployeeMarketingPage() {
  return (
    <EmployeePageShell description="">
      <ComingSoon
        icon="megaphone"
        title="التسويق"
        message="قريبًا في الإصدار القادم"
        description="نعمل على تجهيز قسم التسويق لإدارة حملاتك العقارية بسهولة. ترقّب إطلاقه قريبًا."
      />
    </EmployeePageShell>
  );
}
