import type { ManagerDashboardDto } from '../../lib/api/dashboard-types';

/**
 * Zero-state fallback used until the first dashboard read arrives (and when a
 * read fails, the last successful snapshot stays on screen instead). It is
 * always the real empty value — never a demo baseline.
 */
export const emptyManagerDashboard: ManagerDashboardDto = {
  period: 'month',
  chartBucket: 'day',
  properties: {
    total: 0,
    available: 0,
    pending: 0,
    sold: 0,
    rented: 0,
    rejected: 0,
    archived: 0,
    trash: 0,
  },
  clients: { total: 0, newInPeriod: 0 },
  owners: { total: 0, newInPeriod: 0 },
  employees: { total: 0, active: 0 },
  deals: {
    countInPeriod: 0,
    totalValueInPeriod: '0',
    averageValueInPeriod: '0',
    totalCommissionInPeriod: '0',
    dailyCounts: [],
  },
  followUps: { late: 0, completedInPeriod: 0 },
  leaders: {
    clients: { name: null, count: 0 },
    properties: { name: null, count: 0 },
    deals: { name: null, count: 0 },
  },
  alerts: { lateFollowUps: 0, pendingApprovals: 0, duplicateAttempts: 0 },
  activity: [],
};

/** Compact dashboard number: 14, 18.6K, 1.84M. */
export function compactMetric(value: string | number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0';
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  }
  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(Math.round(numeric));
}

export function compactKwd(value: string | number): string {
  return `${compactMetric(value)} د.ك`;
}
