import type { PropertyStatus, Role } from '@prisma/client';

export interface EmployeePropertyDto {
  id: string;
  reference: string;
  title: string;
  status: PropertyStatus;
}

export interface ManagerCapabilitiesDto {
  approveProperties: boolean;
  rejectProperties: boolean;
}

/**
 * One real EMPLOYEE or MANAGER account. Statistics are derived from real rows
 * linked through `Property.createdByUserId` and the employee profile. No
 * password hash, refresh token or private contact field can appear here.
 */
export interface EmployeeDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  phone: string | null;
  hiredAt: string | null;
  baseSalary: string | null;
  managerUserId: string | null;
  managerName: string | null;
  capabilities: ManagerCapabilitiesDto | null;
  propertyCount: number;
  propertiesByStatus: Record<PropertyStatus, number>;
  properties: EmployeePropertyDto[];
  clientsCount: number;
  assignedCount: number;
  lateCount: number;
}

/**
 * Lightweight directory row: every card/stat field, but no property list.
 * The drawer loads `GET /employees/:id` for the full employee detail.
 */
export type EmployeeListItemDto = Omit<EmployeeDto, 'properties'>;

export interface EmployeeSummaryDto {
  total: number;
  active: number;
  /** Sum of each employee's distinct clients (same semantics as the cards). */
  clientsTotal: number;
  /** Sum of each employee's overdue follow-up subjects. */
  lateTotal: number;
}

export interface EmployeeListDto {
  items: EmployeeListItemDto[];
  nextCursor: string | null;
  /** Full-scope counters; present on the first page. */
  summary?: EmployeeSummaryDto;
}

export interface EmployeePropertyPageDto {
  items: EmployeePropertyDto[];
  nextCursor: string | null;
  /** Total properties of this employee (independent of the page). */
  total: number;
}

export interface ManagerTeamMemberDto {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ManagerDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  capabilities: ManagerCapabilitiesDto;
  teamCount: number;
  /** Complete current team (the expandable manager card). */
  team: ManagerTeamMemberDto[];
}

export interface ManagerListDto {
  items: ManagerDto[];
}
