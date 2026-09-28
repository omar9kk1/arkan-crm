import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import {
  ComingSoonCard,
  ComingSoonPreviews,
} from '../../../components/ui/coming-soon-card';

const previews = [
  {
    title: 'حملات العقارات',
    description: 'تنظيم الحملات التسويقية للعقارات ومتابعة أهدافها.',
  },
  {
    title: 'مصادر العملاء',
    description: 'معرفة قنوات وصول العملاء ومصادر الطلبات.',
  },
  {
    title: 'تكلفة الإعلانات',
    description: 'متابعة ميزانيات الإعلانات والمصروفات المرتبطة بها.',
  },
  {
    title: 'أداء الحملات',
    description: 'مراجعة نتائج الحملات والطلبات الناتجة عنها.',
  },
  {
    title: 'تصوير العقارات والمحتوى',
    description: 'تنظيم احتياجات تصوير العقارات وإعداد المحتوى التسويقي.',
  },
  {
    title: 'ربط التسويق بالمالية',
    description: 'ربط مصروفات التسويق بالعقارات والنتائج المالية.',
  },
];
export function MarketingPage() {
  return (
    <ManagerPageShell
      title="التسويق"
      description="معاينة أدوات التسويق المخطط لها في الإصدار القادم."
    >
      <ComingSoonCard
        title="إدارة التسويق قريبًا"
        description="ستتيح هذه الصفحة إدارة حملات تسويق العقارات، متابعة مصادر العملاء، تكلفة الإعلانات، أداء الحملات، وربط مصروفات التسويق بالعقارات والنتائج."
        note="هذه الصفحة غير مفعّلة في نسخة MVP، وسيتم ربطها لاحقًا بمصادر العملاء والمصروفات والتقارير."
      />
      <ComingSoonPreviews
        label="معاينة أقسام التسويق القادمة"
        items={previews}
      />
    </ManagerPageShell>
  );
}
