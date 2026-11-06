import type {
  ManagerDashboardPeriod,
} from '../../lib/api/dashboard-types';

export const PERIOD_OPTIONS: ReadonlyArray<{
  value: ManagerDashboardPeriod;
  label: string;
}> = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'last_month', label: 'الشهر الماضي' },
  { value: 'all', label: 'كل الوقت' },
];

const LABELS: Record<ManagerDashboardPeriod, string> = {
  today: 'اليوم',
  week: 'هذا الأسبوع',
  month: 'هذا الشهر',
  last_month: 'الشهر الماضي',
  all: 'كل الوقت',
};

const NEW_IN_PERIOD_HINTS: Record<ManagerDashboardPeriod, string> = {
  today: 'اليوم',
  week: 'هذا الأسبوع',
  month: 'هذا الشهر',
  last_month: 'الشهر الماضي',
  all: 'خلال كل الوقت',
};

export function periodLabel(period: ManagerDashboardPeriod): string {
  return LABELS[period] ?? 'هذا الشهر';
}

/** Wording for the "new clients/owners" date-based submetrics. */
export function newInPeriodHint(period: ManagerDashboardPeriod): string {
  return NEW_IN_PERIOD_HINTS[period] ?? 'هذا الشهر';
}
