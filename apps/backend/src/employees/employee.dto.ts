import type { PropertyStatus, Role } from '@prisma/client';

/**
 * Explicit, privacy-safe projection of one created property, used by the
 * employee file drawer. It carries only the fields the card needs and never any
 * owner/broker contact data.
 */
export interface EmployeePropertyDto {
  id: string;
  reference: string;
  title: string;
  status: PropertyStatus;
}

/**
 * One real EMPLOYEE-role account.
 *
 * `propertyCount` / `propertiesByStatus` / `properties` are the ONLY statistics
 * this endpoint reports: they are computed from real rows linked through
 * `Property.createdByUserId`, which is the one employee relationship the backend
 * actually implements. Client, assignment, deal, commission and follow-up totals
 * are deliberately absent — those domains have no backend feature yet, so the UI
 * renders an unavailable state instead of inventing a zero.
 *
 * No password hash, refresh token or private contact field can appear here.
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
  propertyCount: number;
  propertiesByStatus: Record<PropertyStatus, number>;
  properties: EmployeePropertyDto[];
  clientsCount: number;
  assignedCount: number;
  lateCount: number;
}

export interface EmployeeListDto {
  items: EmployeeDto[];
}
