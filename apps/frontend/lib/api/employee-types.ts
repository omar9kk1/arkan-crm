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
export interface EmployeeDto {
  id: string;
  name: string;
  email: string;
  role: EmployeeRoleApi;
  isActive: boolean;
  phone: string | null;
  hiredAt: string | null;
  baseSalary: string | null;
  /** Real count linked through `Property.createdByUserId`. */
  propertyCount: number;
  propertiesByStatus: Record<PropertyStatusApi, number>;
  /** Newest properties, bounded, for the employee file drawer. */
  properties: EmployeePropertyDto[];
}

export interface EmployeeListDto {
  items: EmployeeDto[];
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
