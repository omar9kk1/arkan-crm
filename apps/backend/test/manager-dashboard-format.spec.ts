import {
  compactKwd,
  compactMetric,
  emptyManagerDashboard,
} from '../../frontend/features/manager-dashboard/dashboard-preview';
import {
  kuwaitHourOfDay,
  periodWindow,
} from '../src/dashboard/dashboard.service';

describe('Manager dashboard presentation values', () => {
  it('keeps the zero state at real zero (never a demo baseline)', () => {
    expect(emptyManagerDashboard.properties.total).toBe(0);
    expect(emptyManagerDashboard.clients.total).toBe(0);
    expect(emptyManagerDashboard.owners.total).toBe(0);
    expect(emptyManagerDashboard.deals.countInPeriod).toBe(0);
    expect(emptyManagerDashboard.deals.totalValueInPeriod).toBe('0');
    expect(emptyManagerDashboard.followUps.late).toBe(0);
    expect(emptyManagerDashboard.activity).toEqual([]);
  });

  it('formats compact dashboard values in the existing visual style', () => {
    expect(compactMetric('0')).toBe('0');
    expect(compactMetric(14)).toBe('14');
    expect(compactMetric('18600')).toBe('18.6K');
    expect(compactMetric('1840000')).toBe('1.84M');
    expect(compactKwd('0')).toBe('0 د.ك');
    expect(compactKwd('7500')).toBe('7.5K د.ك');
  });
});

describe('Manager dashboard period boundaries (Asia/Kuwait)', () => {
  // Thursday 2026-11-05 23:30 Kuwait = 2026-11-05T20:30Z.
  const now = new Date('2026-11-05T20:30:00.000Z');

  it('uses inclusive start / exclusive end in UTC+3', () => {
    const today = periodWindow('today', now);
    expect(today.start?.toISOString()).toBe('2026-11-04T21:00:00.000Z');
    expect(today.end?.toISOString()).toBe('2026-11-05T21:00:00.000Z');
    expect(today.bucket).toBe('hour');
    expect(today.bucketCount).toBe(24);

    const week = periodWindow('week', now);
    // Saturday 2026-10-31 00:00 Kuwait.
    expect(week.start?.toISOString()).toBe('2026-10-30T21:00:00.000Z');
    expect(week.end?.toISOString()).toBe('2026-11-06T21:00:00.000Z');
    expect(week.bucketCount).toBe(7);

    const month = periodWindow('month', now);
    expect(month.start?.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(month.end?.toISOString()).toBe('2026-11-30T21:00:00.000Z');
    expect(month.bucketCount).toBe(30);

    const lastMonth = periodWindow('last_month', now);
    expect(lastMonth.start?.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(lastMonth.end?.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(lastMonth.bucketCount).toBe(31);

    const all = periodWindow('all', now);
    expect(all.start).toBeNull();
    expect(all.end).toBeNull();
    expect(all.bucket).toBe('month');
    expect(all.todayStart.toISOString()).toBe('2026-11-04T21:00:00.000Z');
  });

  it('maps an instant to its Kuwait hour, not its UTC hour', () => {
    expect(kuwaitHourOfDay(new Date('2026-11-05T20:30:00.000Z'))).toBe(23);
    expect(kuwaitHourOfDay(new Date('2026-11-05T21:30:00.000Z'))).toBe(0);
  });
});
