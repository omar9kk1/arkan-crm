'use client';

import { useState } from 'react';
import { GlassSelect } from '../../../components/ui/glass-select';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import type { ManagerDashboardPeriod } from '../../../lib/api/dashboard-types';
import { emptyManagerDashboard } from '../dashboard-preview';
import {
  newInPeriodHint,
  PERIOD_OPTIONS,
} from '../period-label';
import { useManagerDashboard } from '../use-manager-dashboard';
import { DashboardStats } from './dashboard-stats';
import { DealsChartPlaceholder } from './deals-chart-placeholder';
import { TopEmployeesPlaceholder } from './top-employees-placeholder';
import { PropertiesSummary } from './properties-summary';
import { PeopleSummary } from './people-summary';
import { DashboardFeed } from './dashboard-feed';
import styles from './dashboard.module.css';

export function ManagerDashboard() {
  const [period, setPeriod] = useState<ManagerDashboardPeriod>('month');
  const { data, loading, error } = useManagerDashboard(period);
  const dashboard = data ?? emptyManagerDashboard;
  const newInPeriod = newInPeriodHint(period);

  const stats = [
    {
      title: 'إجمالي العقارات',
      value: dashboard.properties.total,
      hint: `${dashboard.properties.available} متاح · ${dashboard.properties.pending} بانتظار الموافقة`,
      icon: 'building' as const,
    },
    {
      title: 'إجمالي العملاء',
      value: dashboard.clients.total,
      hint: `${dashboard.clients.newInPeriod} عملاء جدد ${newInPeriod}`,
      icon: 'users' as const,
    },
    {
      title: 'إجمالي الملاك',
      value: dashboard.owners.total,
      hint: `${dashboard.owners.newInPeriod} ملاك جدد ${newInPeriod}`,
      icon: 'home' as const,
    },
    {
      title: 'إجمالي الموظفين',
      value: dashboard.employees.total,
      hint: `${dashboard.employees.active} حساب نشط`,
      icon: 'users' as const,
    },
  ];

  const alertItems = [
    {
      title: 'متابعة مالك متأخرة',
      detail: dashboard.alerts.lateFollowUps
        ? `${dashboard.alerts.lateFollowUps} متابعة تحتاج مراجعة`
        : 'لا توجد متابعات متأخرة',
      warning: dashboard.alerts.lateFollowUps > 0,
    },
    {
      title: 'عقارات تحتاج اعتماد',
      detail: `${dashboard.alerts.pendingApprovals} عقار بانتظار المراجعة`,
    },
    {
      title: 'محاولات تسجيل مكرر',
      detail: dashboard.alerts.duplicateAttempts
        ? `${dashboard.alerts.duplicateAttempts} محاولة مسجلة ${newInPeriod}`
        : 'لا توجد محاولات مكررة حديثة',
    },
  ];
  const alertCount = [
    dashboard.alerts.lateFollowUps,
    dashboard.alerts.pendingApprovals,
    dashboard.alerts.duplicateAttempts,
  ].filter((value) => value > 0).length;

  const activityItems = dashboard.activity.length
    ? dashboard.activity
    : [
        {
          title: loading ? 'جارٍ تحميل النشاط…' : 'لا يوجد نشاط حديث',
          detail: loading ? 'يتم تحديث بيانات اللوحة.' : 'لم يُسجَّل نشاط بعد.',
        },
      ];

  return (
    <ManagerPageShell
      title="الرئيسية"
      description="لوحة مؤشرات المدير: حجم النظام، أداء الموظفين، العقارات، العملاء، الملاك، الصفقات، والتنبيهات المهمة."
      actions={
        <label className={styles.period}>
          الفترة
          <GlassSelect
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as ManagerDashboardPeriod)
            }
            aria-describedby="dashboard-preview"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </GlassSelect>
        </label>
      }
    >
      <p
        id="dashboard-preview"
        className={styles.preview}
        aria-busy={loading}
        title={error ?? undefined}
      >
        بيانات مباشرة من قاعدة البيانات • الفترة المختارة
      </p>
      <DashboardStats items={stats} />
      <div className={styles.panels}>
        <DealsChartPlaceholder deals={dashboard.deals} />
        <TopEmployeesPlaceholder leaders={dashboard.leaders} />
        <PropertiesSummary properties={dashboard.properties} />
        <PeopleSummary
          clients={dashboard.clients}
          owners={dashboard.owners}
          followUps={dashboard.followUps}
        />
        <DashboardFeed
          title="تنبيهات مهمة"
          description="أهم الأشياء التي تحتاج مراجعة المدير."
          badge={`${alertCount} تنبيهات`}
          items={alertItems}
        />
        <DashboardFeed
          title="آخر الأنشطة"
          description="أحدث حركة حصلت في النظام حسب الفترة المختارة."
          items={activityItems}
        />
      </div>
    </ManagerPageShell>
  );
}
