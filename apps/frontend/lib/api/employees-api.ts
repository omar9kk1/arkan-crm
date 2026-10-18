import { authorizedRequest } from './authorized';
import type {
  CreateEmployeePayload,
  EmployeeDto,
  EmployeeListDto,
  SetEmployeeActivationPayload,
  UpdateEmployeePayload,
} from './employee-types';

const BASE = '/employees';

/**
 * `GET /employees` — MANAGER only. Lists the real EMPLOYEE-role accounts with
 * their property statistics; the caller's role is enforced by the backend, never
 * by the UI.
 */
export function listEmployees(): Promise<EmployeeListDto> {
  return authorizedRequest<EmployeeListDto>(BASE);
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
