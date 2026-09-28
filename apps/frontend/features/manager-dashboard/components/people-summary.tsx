import { dashboardPreview } from '../dashboard-preview';
import { DashboardPanel } from './dashboard-panel';
import { SummaryMetrics } from './summary-metrics';

export function PeopleSummary() {
  return (
    <DashboardPanel
      title="العملاء والملاك"
      description="حركة العملاء والملاك والمتابعات المتأخرة."
    >
      <SummaryMetrics items={dashboardPreview.people} />
    </DashboardPanel>
  );
}
