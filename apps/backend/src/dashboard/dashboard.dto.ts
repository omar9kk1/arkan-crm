export const MANAGER_DASHBOARD_PERIODS = [
  'today',
  'week',
  'month',
  'last_month',
  'all',
] as const;

export type ManagerDashboardPeriod =
  (typeof MANAGER_DASHBOARD_PERIODS)[number];

/**
 * Manager dashboard projection. Read-only and privacy-safe: counts only,
 * public/manager-authorized labels and no client/owner contact details.
 */
export interface ManagerDashboardDto {
  period: ManagerDashboardPeriod;
  /** Resolution of the chart buckets for the selected period. */
  chartBucket: 'hour' | 'day' | 'month';
  properties: {
    /** Every active property (`deletedAt = null`), all statuses. */
    total: number;
    available: number;
    pending: number;
    sold: number;
    rented: number;
    rejected: number;
    archived: number;
    /** Soft-deleted rows only (Manager Trash). */
    trash: number;
  };
  clients: {
    total: number;
    newInPeriod: number;
  };
  owners: {
    /** Official `Contact` rows of type OWNER — never a provisional owner. */
    total: number;
    newInPeriod: number;
  };
  employees: {
    total: number;
    active: number;
  };
  deals: {
    /** Deals closed inside the selected period. */
    countInPeriod: number;
    totalValueInPeriod: string;
    averageValueInPeriod: string;
    totalCommissionInPeriod: string;
    /** One integer per chart bucket (hour/day/month, see chartBucket). */
    dailyCounts: number[];
  };
  followUps: {
    /** Active follow-up subjects due before today (Kuwait calendar). */
    late: number;
    /** Follow-up history entries saved inside the selected period. */
    completedInPeriod: number;
  };
  leaders: {
    clients: { name: string | null; count: number };
    properties: { name: string | null; count: number };
    deals: { name: string | null; count: number };
  };
  alerts: {
    lateFollowUps: number;
    pendingApprovals: number;
    /** Duplicate-registration alerts for this Manager in the last 7 days. */
    duplicateAttempts: number;
  };
  activity: Array<{
    title: string;
    detail: string;
    warning?: boolean;
  }>;
}
