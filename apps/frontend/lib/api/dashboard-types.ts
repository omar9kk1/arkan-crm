export const MANAGER_DASHBOARD_PERIODS = [
  'today',
  'week',
  'month',
  'last_month',
  'all',
] as const;

export type ManagerDashboardPeriod =
  (typeof MANAGER_DASHBOARD_PERIODS)[number];

export interface ManagerDashboardDto {
  period: ManagerDashboardPeriod;
  chartBucket: 'hour' | 'day' | 'month';
  properties: {
    total: number;
    available: number;
    pending: number;
    sold: number;
    rented: number;
    rejected: number;
    archived: number;
    trash: number;
  };
  clients: { total: number; newInPeriod: number };
  owners: { total: number; newInPeriod: number };
  employees: { total: number; active: number };
  deals: {
    countInPeriod: number;
    totalValueInPeriod: string;
    averageValueInPeriod: string;
    totalCommissionInPeriod: string;
    dailyCounts: number[];
  };
  followUps: { late: number; completedInPeriod: number };
  leaders: {
    clients: { name: string | null; count: number };
    properties: { name: string | null; count: number };
    deals: { name: string | null; count: number };
  };
  alerts: {
    lateFollowUps: number;
    pendingApprovals: number;
    duplicateAttempts: number;
  };
  activity: Array<{ title: string; detail: string; warning?: boolean }>;
}
