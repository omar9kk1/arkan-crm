import { authorizedRequest } from './authorized';
import type {
  ManagerDashboardDto,
  ManagerDashboardPeriod,
} from './dashboard-types';

/** Manager-only live home dashboard aggregates for the selected period. */
export function getManagerDashboard(
  period: ManagerDashboardPeriod,
): Promise<ManagerDashboardDto> {
  return authorizedRequest<ManagerDashboardDto>(
    `/dashboard/manager?period=${encodeURIComponent(period)}`,
  );
}
