import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import {
  ComingSoonCard,
  ComingSoonPreviews,
} from '../../../components/ui/coming-soon-card';

const previews = [
  {
    title: 'تقارير المبيعات',
    description: 'ملخص المبيعات والصفقات ومؤشرات تطورها خلال الفترات المختلفة.',
  },
  {
    title: 'تقارير الموظفين',
    description: 'متابعة أداء الموظفين والصفقات والعمولات المرتبطة بهم.',
  },
  {
    title: 'تقارير العقارات',
    description: 'نظرة على العقارات وحالاتها وتوزيعها حسب المنطقة.',
  },
  {
    title: 'تقارير العملاء والملاك',
    description: 'ملخص العملاء والملاك والطلبات ونتائج المتابعات.',
  },
  {
    title: 'التقارير المالية',
    description: 'عرض العمولات والرواتب والمصاريف وصافي الحركة المالية.',
  },
  {
    title: 'تقارير الحضور والانصراف',
    description: 'ملخص الحضور وساعات العمل والتأخير والغياب.',
  },
];

export function ReportsPage() {
  return (
    <ManagerPageShell
      title="التقارير"
      description="معاينة التقارير المخطط لها في الإصدار القادم."
    >
      <ComingSoonCard
        title="التقارير التفصيلية قريبًا"
        description="ستتيح هذه الصفحة تقارير المبيعات، أداء الموظفين، العقارات، العملاء، الملاك، الصفقات، العمولات، الحضور، والمالية."
      />
      <ComingSoonPreviews label="معاينة التقارير القادمة" items={previews} />
    </ManagerPageShell>
  );
}
