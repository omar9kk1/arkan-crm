import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { ComingSoon } from '../../../components/ui/coming-soon';

export default function Page() {
  return (
    <ManagerPageShell title="" description="">
      <ComingSoon
        icon="barChart3"
        title="التقارير"
        message="قريبًا في الإصدار القادم"
        description="نعمل على تجهيز نظام التقارير والتحليلات الشاملة، وسيكون متاحًا في إصدار قادم."
      />
    </ManagerPageShell>
  );
}
