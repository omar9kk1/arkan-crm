import type { PropertyStatusApi } from '../../lib/api/property-types';
import type {
  EmployeeDto,
  EmployeeListItemDto,
  EmployeePropertyDto,
  EmployeeRoleApi,
} from '../../lib/api/employee-types';
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
 * linked through `Property.createdByUserId`; `dealsCount` and `commission` come
 * from the backend's set-based deal/commission aggregates. A metric stays
 * `null` only when the backend genuinely has no value.
 */
export interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: EmployeeRoleApi;
  roleLabel: string;
  managerUserId: string | null;
  managerName: string | null;
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
  /** Exact KWD decimal string from the API, or null when unavailable. */
  commission: string | null;
  lateCount: number | null;
}

export function mapEmployeeProperty(
  dto: EmployeePropertyDto,
): EmployeePropertyRef {
  return {
    id: dto.id,
    reference: dto.reference,
    title: dto.title,
    status: dto.status,
    statusLabel: STATUS_LABEL[dto.status],
  };
}

export function mapEmployeeListItem(
  dto: EmployeeListItemDto,
): EmployeeRecord {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    active: dto.isActive,
    role: dto.role,
    roleLabel: ROLE_LABEL[dto.role],
    managerUserId: dto.managerUserId,
    managerName: dto.managerName,
    phone: dto.phone ?? '',
    hiredAt: dto.hiredAt ? dto.hiredAt.slice(0, 10) : '',
    salary: dto.baseSalary === null ? null : Number(dto.baseSalary),
    propertyCount: dto.propertyCount,
    propertiesByStatus: dto.propertiesByStatus,
    properties: [],
    clientsCount: dto.clientsCount,
    assignedCount: dto.assignedCount,
    dealsCount: dto.dealsCount,
    commission: dto.commissionTotal,
    lateCount: dto.lateCount,
  };
}

export function mapEmployee(dto: EmployeeDto): EmployeeRecord {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    active: dto.isActive,
    role: dto.role,
    roleLabel: ROLE_LABEL[dto.role],
    managerUserId: dto.managerUserId,
    managerName: dto.managerName,
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
    // Real backend aggregates (the API always returns these fields).
    clientsCount: dto.clientsCount,
    assignedCount: dto.assignedCount,
    dealsCount: dto.dealsCount,
    commission: dto.commissionTotal,
    lateCount: dto.lateCount,
  };
}

/** `«معتمد 3 · بانتظار الموافقة 2»`, or an empty string when there are none. */
export function propertyStatusSummary(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(
      ([status, count]) =>
        `${STATUS_LABEL[status as PropertyStatusApi]} ${count}`,
    )
    .join(' · ');
}

export const money = (amount: number) =>
  `${new Intl.NumberFormat('ar-KW').format(amount)} د.ك`;

/** Employee commission totals are exact API strings; always show 3 decimals. */
export const commissionMoney = (amount: string) =>
  `${new Intl.NumberFormat('ar-KW', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number(amount))} د.ك`;
