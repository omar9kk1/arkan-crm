import type { PropertyStatusApi } from './property-types';

/**
 * Types mirroring the backend responses of `GET/POST/PATCH /employees`.
 *
 * The backend derives every relationship from a stable `User.id` (or its 1:1
 * `EmployeeProfile`), so nothing here is ever matched by display name. Private
 * data is absent by construction: there is no password hash, refresh token or
 * owner/broker contact field on these shapes.
 */

export type EmployeeRoleApi = 'EMPLOYEE' | 'MANAGER';

export interface EmployeePropertyDto {
  id: string;
  reference: string;
  title: string;
  status: PropertyStatusApi;
}

/** One real EMPLOYEE-role account and its real property statistics. */
export interface ManagerCapabilitiesApi {
  approveProperties: boolean;
  rejectProperties: boolean;
}

export interface EmployeeDto {
  id: string;
  name: string;
  email: string;
  role: EmployeeRoleApi;
  isActive: boolean;
  phone: string | null;
  hiredAt: string | null;
  baseSalary: string | null;
  managerUserId: string | null;
  managerName: string | null;
  capabilities: ManagerCapabilitiesApi | null;
  /** Real count linked through `Property.createdByUserId`. */
  propertyCount: number;
  propertiesByStatus: Record<PropertyStatusApi, number>;
  /** Newest properties, bounded, for the employee file drawer. */
  properties: EmployeePropertyDto[];
  /** Distinct clients owned or assigned to this employee. */
  clientsCount: number;
  /** Distinct properties actually assigned to this employee. */
  assignedCount: number;
  /** Distinct overdue follow-up subjects for this employee. */
  lateCount: number;
}

/** Directory row: all card/stat fields, no property list. */
export type EmployeeListItemDto = Omit<EmployeeDto, 'properties'>;

export interface EmployeeSummaryApiDto {
  total: number;
  active: number;
  clientsTotal: number;
  lateTotal: number;
}

export interface EmployeePropertyPageApiDto {
  items: EmployeePropertyDto[];
  nextCursor: string | null;
  total: number;
}

export interface EmployeeListDto {
  items: EmployeeListItemDto[];
  nextCursor: string | null;
  /** Full-scope counters; present on the first page. */
  summary?: EmployeeSummaryApiDto;
}

/**
 * Body of `POST /employees`. Only persisted fields are accepted — there is no
 * `notes` field because neither `User` nor `EmployeeProfile` has a column for it.
 */
export interface CreateEmployeePayload {
  name: string;
  email: string;
  password: string;
  role: EmployeeRoleApi;
  phone?: string;
  hiredAt?: string;
  baseSalary?: number;
  isActive?: boolean;
  managerUserId?: string;
}

export interface ManagerTeamMemberApiDto {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ManagerDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  capabilities: ManagerCapabilitiesApi;
  teamCount: number;
  /** Complete current team for the expandable manager card. */
  team: ManagerTeamMemberApiDto[];
}

export interface ManagerListDto {
  items: ManagerDto[];
}

export interface AssignManagerPayload {
  managerUserId: string | null;
}

export interface ManagerPermissionsPayload {
  canApprove: boolean;
  canReject: boolean;
}

/** Body of `PATCH /employees/:id` — the display name is the only editable field. */
export interface UpdateEmployeePayload {
  name: string;
}

/**
 * Body of `PATCH /employees/:id/activation` — the desired account state is the
 * only accepted field; role, email and password stay untouched by the backend.
 */
export interface SetEmployeeActivationPayload {
  isActive: boolean;
}
