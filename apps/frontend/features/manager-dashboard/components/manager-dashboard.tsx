import { GlassSelect } from '../../../components/ui/glass-select';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { dashboardPreview } from '../dashboard-preview';
import { DashboardStats } from './dashboard-stats';
import { DealsChartPlaceholder } from './deals-chart-placeholder';
import { TopEmployeesPlaceholder } from './top-employees-placeholder';
import { PropertiesSummary } from './properties-summary';
import { PeopleSummary } from './people-summary';
import { DashboardFeed } from './dashboard-feed';
import styles from './dashboard.module.css';
export function ManagerDashboard() {
  return (
    <ManagerPageShell
      title="الرئيسية"
      description="لوحة مؤشرات المدير: حجم النظام، أداء الموظفين، العقارات، العملاء، الملاك، الصفقات، والتنبيهات المهمة."
      actions={
        <label className={styles.period}>
          الفترة
          <GlassSelect
            disabled
            defaultValue="month"
            aria-describedby="dashboard-preview"
          >
            <option value="today">اليوم</option>
            <option value="week">آخر 7 أيام</option>
            <option value="month">الشهر الحالي</option>
            <option value="all">كل الوقت</option>
          </GlassSelect>
        </label>
      }
    >
      <p id="dashboard-preview" className={styles.preview}>
        معاينة ببيانات تجريبية فقط • الفترة ثابتة على الشهر الحالي لحين ربط
        البيانات
      </p>
      <DashboardStats />
      <div className={styles.panels}>
        <DealsChartPlaceholder />
        <TopEmployeesPlaceholder />
        <PropertiesSummary />
        <PeopleSummary />
        <DashboardFeed
          title="تنبيهات مهمة"
          description="أهم الأشياء التي تحتاج مراجعة المدير."
          badge="3 تنبيهات"
          items={dashboardPreview.alerts}
        />
        <DashboardFeed
          title="آخر الأنشطة"
          description="أحدث حركة حصلت في النظام حسب الفترة المختارة."
          items={dashboardPreview.activity}
        />
      </div>
    </ManagerPageShell>
  );
}
