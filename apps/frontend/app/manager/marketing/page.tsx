import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { ComingSoon } from '../../../components/ui/coming-soon';

export default function Page() {
  return (
    <ManagerPageShell title="" description="">
      <ComingSoon
        icon="megaphone"
        title="التسويق"
        message="قريبًا في الإصدار القادم"
        description="نعمل على تجهيز أدوات التسويق العقاري لتكون متاحة في إصدار قادم."
      />
    </ManagerPageShell>
  );
}
