import { authorizedRequest } from './authorized';
import type {
  AssignManagerPayload,
  CreateEmployeePayload,
  EmployeeDto,
  EmployeeListDto,
  EmployeePropertyPageApiDto,
  ManagerDto,
  ManagerListDto,
  ManagerPermissionsPayload,
  SetEmployeeActivationPayload,
  UpdateEmployeePayload,
} from './employee-types';

const BASE = '/employees';

/**
 * `GET /employees` — MANAGER only. Lists the real EMPLOYEE-role accounts with
 * their property statistics; the caller's role is enforced by the backend, never
 * by the UI.
 */
export type EmployeeStatusQuery = 'all' | 'active' | 'inactive';

export type EmployeeSortQuery =
  | 'clientsCount'
  | 'propertiesCount'
  | 'dealsCount';

export interface EmployeeListQuery {
  search?: string;
  status?: EmployeeStatusQuery;
  sort?: EmployeeSortQuery;
  cursor?: string;
  limit?: number;
}

export interface EmployeePropertyQuery {
  cursor?: string;
  limit?: number;
}

function employeeQueryString(query: EmployeeListQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status && query.status !== 'all') {
    params.set('status', query.status);
  }
  if (query.sort) params.set('sort', query.sort);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function listEmployees(
  query: EmployeeListQuery = {},
): Promise<EmployeeListDto> {
  return authorizedRequest<EmployeeListDto>(
    BASE + employeeQueryString(query),
  );
}

/** `GET /employees/:id` — full employee detail for the drawer. */
export function getEmployee(id: string): Promise<EmployeeDto> {
  return authorizedRequest<EmployeeDto>(`${BASE}/${id}`);
}

/** `GET /employees/:id/properties` — authorized cursor page of properties. */
export function listEmployeeProperties(
  id: string,
  query: EmployeePropertyQuery = {},
): Promise<EmployeePropertyPageApiDto> {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const value = params.toString();
  return authorizedRequest<EmployeePropertyPageApiDto>(
    `${BASE}/${id}/properties${value ? `?${value}` : ''}`,
  );
}

/**
 * `POST /employees` — MANAGER only. Creates a real `User` (+ `EmployeeProfile`)
 * so the account can log in with the same hashing convention as the login flow.
 * A duplicate email is answered with 409, never overwritten.
 */
export function createEmployee(
  payload: CreateEmployeePayload,
): Promise<EmployeeDto> {
  return authorizedRequest<EmployeeDto>(BASE, {
    method: 'POST',
    body: payload,
  });
}

/**
 * `PATCH /employees/:id` — MANAGER only. Renames an employee's display name.
 * `User.id`, email, password, role and every linked record stay untouched.
 */
export function updateEmployeeName(
  id: string,
  name: string,
): Promise<EmployeeDto> {
  const body: UpdateEmployeePayload = { name };
  return authorizedRequest<EmployeeDto>(`${BASE}/${id}`, {
    method: 'PATCH',
    body,
  });
}

/**
 * `PATCH /employees/:id/activation` — MANAGER only. Activates or deactivates an
 * EMPLOYEE account. Deactivation revokes the account's sessions on the server;
 * `User.id`, email, role and every linked record (properties, contacts,
 * statistics) stay untouched.
 */
export function setEmployeeActivation(
  id: string,
  isActive: boolean,
): Promise<EmployeeDto> {
  const body: SetEmployeeActivationPayload = { isActive };
  return authorizedRequest<EmployeeDto>(`${BASE}/${id}/activation`, {
    method: 'PATCH',
    body,
  });
}

/** `GET /managers` — OWNER-only Manager directory with live capabilities. */
export function listManagers(): Promise<ManagerListDto> {
  return authorizedRequest<ManagerListDto>('/managers');
}

/** `PATCH /employees/:id/manager` — OWNER assigns/transfers or unassigns. */
export function assignEmployeeManager(
  id: string,
  managerUserId: string | null,
): Promise<EmployeeDto> {
  const body: AssignManagerPayload = { managerUserId };
  return authorizedRequest<EmployeeDto>(`${BASE}/${id}/manager`, {
    method: 'PATCH',
    body,
  });
}

/** `PATCH /managers/:id/permissions` — independent approve/reject grant. */
export function setManagerPermissions(
  id: string,
  payload: ManagerPermissionsPayload,
): Promise<ManagerDto> {
  return authorizedRequest<ManagerDto>(`/managers/${id}/permissions`, {
    method: 'PATCH',
    body: payload,
  });
}
