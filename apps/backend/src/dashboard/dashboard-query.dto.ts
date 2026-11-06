import { IsIn, IsOptional } from 'class-validator';
import {
  MANAGER_DASHBOARD_PERIODS,
  type ManagerDashboardPeriod,
} from './dashboard.dto';

export class ManagerDashboardQueryDto {
  /** Defaults to the current Kuwait month. */
  @IsOptional()
  @IsIn(MANAGER_DASHBOARD_PERIODS)
  period?: ManagerDashboardPeriod;
}
