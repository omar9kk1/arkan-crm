import type { ManagerDashboardDto } from '../../../lib/api/dashboard-types';
import { DashboardPanel } from './dashboard-panel';
import { SummaryMetrics } from './summary-metrics';

export function PeopleSummary({
  clients,
  owners,
  followUps,
}: {
  clients: ManagerDashboardDto['clients'];
  owners: ManagerDashboardDto['owners'];
  followUps: ManagerDashboardDto['followUps'];
}) {
  return (
    <DashboardPanel
      title="العملاء والملاك"
      description="حركة العملاء والملاك والمتابعات المتأخرة."
    >
      <SummaryMetrics
        items={[
          { label: 'عملاء جدد', value: clients.newInPeriod },
          { label: 'ملاك جدد', value: owners.newInPeriod },
          {
            label: 'متابعات متأخرة',
            value: followUps.late,
            warning: followUps.late > 0,
          },
          { label: 'متابعة تمت', value: followUps.completedInPeriod },
        ]}
      />
    </DashboardPanel>
  );
}
