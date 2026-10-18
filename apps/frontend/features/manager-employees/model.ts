import type { PropertyStatusApi } from '../../lib/api/property-types';
import type { EmployeeDto, EmployeeRoleApi } from '../../lib/api/employee-types';
import { STATUS_LABEL } from '../../lib/property-adapter';

/**
 * Rendered wherever the backend genuinely has no value for a metric — never a
 * fabricated zero, and never a missing-data-as-zero.
 */
export const UNAVAILABLE = '—';

/** Real `User.role` → the wording the card subtitle / drawer header shows. */
const ROLE_LABEL: Record<EmployeeRoleApi, string> = {
  EMPLOYEE: 'موظف',
  MANAGER: 'مدير',
};

export interface EmployeePropertyRef {
  id: string;
  reference: string;
  title: string;
  status: PropertyStatusApi;
  statusLabel: string;
}

/**
 * UI model for one real EMPLOYEE account.
 *
 * `propertyCount` / `propertiesByStatus` / `properties` are the real statistics
 * linked through `Property.createdByUserId`. The remaining metrics are typed
 * `number | null` and stay `null` because those domains have no backend feature
 * yet: they are rendered «—», never a fake or assumed zero. `id` is always
 * `User.id` — no relationship is ever keyed by display name.
 */
export interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roleLabel: string;
  /** Empty string when the profile value is unset. */
  phone: string;
  /** `YYYY-MM-DD`, or an empty string when unset. */
  hiredAt: string;
  /** `null` when unset — never coerced to 0. */
  salary: number | null;
  propertyCount: number;
  propertiesByStatus: Record<string, number>;
  properties: EmployeePropertyRef[];
  clientsCount: number | null;
  assignedCount: number | null;
  dealsCount: number | null;
  commission: number | null;
  lateCount: number | null;
}

export function mapEmployee(dto: EmployeeDto): EmployeeRecord {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    active: dto.isActive,
    roleLabel: ROLE_LABEL[dto.role],
    phone: dto.phone ?? '',
    hiredAt: dto.hiredAt ? dto.hiredAt.slice(0, 10) : '',
    salary: dto.baseSalary === null ? null : Number(dto.baseSalary),
    propertyCount: dto.propertyCount,
    propertiesByStatus: dto.propertiesByStatus,
    properties: dto.properties.map((property) => ({
      id: property.id,
      reference: property.reference,
      title: property.title,
      status: property.status,
      statusLabel: STATUS_LABEL[property.status],
    })),
    // No backend surface yet → explicitly unavailable.
    clientsCount: null,
    assignedCount: null,
    dealsCount: null,
    commission: null,
    lateCount: null,
  };
}

/** `«معتمد 3 · بانتظار الموافقة 2»`, or an empty string when there are none. */
export function propertyStatusSummary(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${STATUS_LABEL[status as PropertyStatusApi]} ${count}`)
    .join(' · ');
}

export const money = (amount: number) =>
  `${new Intl.NumberFormat('ar-KW').format(amount)} د.ك`;
