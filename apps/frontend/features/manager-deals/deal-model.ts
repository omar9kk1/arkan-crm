import type {
  DealApiDto,
  DealOptionClientApiDto,
  DealOptionEmployeeApiDto,
  DealOptionPropertyApiDto,
  DealTypeApi,
} from '../../lib/api/deal-types';

export type DealTypeLabel = 'بيع' | 'تأجير' | 'تبادل';

export interface DealPropertyOption {
  id: string;
  code: string;
  title: string;
  area: string;
  owner: string;
  status: string;
  statusLabel: string;
  available: boolean;
  listingType: DealTypeApi;
  suggestedEmployeeUserId: string;
  suggestedEmployeeName: string;
}

export interface DealClientOption {
  id: string;
  name: string;
  employee: string;
  employeeUserId: string;
}

export interface DealEmployeeOption {
  userId: string;
  name: string;
}

/** One employee commission row of a saved deal (payout state included). */
export interface DealCommission {
  id: string;
  role: 'PROPERTY_EMPLOYEE' | 'CLIENT_EMPLOYEE' | 'MANUAL';
  /** Exact decimal string from the API. */
  amount: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  paidAt: string | null;
  employeeUserId: string;
}

export const COMMISSION_STATUS_LABEL: Record<
  DealCommission['status'],
  string
> = {
  PENDING: 'بانتظار الدفع',
  PAID: 'تم الدفع',
  CANCELLED: 'ملغاة',
};

/** The wizard draft (local state only until the API call succeeds). */
export interface DealDraft {
  propertyId: string;
  clientId: string;
  propertyEmployeeUserId: string;
  propertyEmployeeName: string;
  clientEmployeeUserId: string;
  clientEmployeeName: string;
  type: 'بيع' | 'تأجير';
  price: number;
  companyCommission: number;
  propertyCommission: number;
  clientCommission: number;
  date: string;
  notes: string;
}

/** The view model consumed by the existing cards/drawer. */
export interface Deal {
  id: string;
  reference: string;
  /** Property display code (A-code when approved, otherwise the P-code). */
  propertyId: string;
  clientId: string;
  property: {
    id: string;
    title: string;
    area: string;
    owner: string;
    status: string;
    statusLabel: string;
  };
  client: { id: string; name: string; employee: string };
  propertyEmployee: string;
  clientEmployee: string;
  type: DealTypeLabel;
  price: number;
  companyCommission: number;
  propertyCommission: number;
  clientCommission: number;
  priceFils: bigint;
  companyCommissionFils: bigint;
  propertyCommissionFils: bigint;
  clientCommissionFils: bigint;
  date: string;
  notes: string;
  createdBy: string;
  commissions: DealCommission[];
}

/** The shared commission shape of a saved deal and the create draft. */
export type CommissionView = Pick<
  Deal,
  | 'companyCommission'
  | 'propertyCommission'
  | 'clientCommission'
  | 'propertyEmployee'
  | 'clientEmployee'
>;

export const DEAL_TYPE_LABEL: Record<DealTypeApi, DealTypeLabel> = {
  SALE: 'بيع',
  RENT: 'تأجير',
  EXCHANGE: 'تبادل',
};

export const PROPERTY_STATUS_LABEL: Record<string, string> = {
  PENDING: 'قيد المراجعة',
  AVAILABLE: 'متاح',
  REJECTED: 'مرفوض',
  SOLD: 'تم البيع',
  RENTED: 'تم التأجير',
  ARCHIVED: 'مؤرشف',
};

const MONEY = new Intl.NumberFormat('ar-KW', { maximumFractionDigits: 3 });

export function money(value: number | string): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return `${MONEY.format(Number.isFinite(numeric) ? numeric : 0)} د.ك`;
}

/** Exact decimal string → integer fils (KWD, 3 decimals; no floating point). */
export function toFils(value: number | string): bigint {
  const text = typeof value === 'number' ? value.toString() : value;
  const [integerPart = '0', fraction = ''] = text.split('.');
  const negative = integerPart.startsWith('-');
  const absolute = negative ? integerPart.slice(1) : integerPart;
  const fils =
    BigInt(absolute || '0') * 1000n +
    BigInt((fraction + '000').slice(0, 3));
  return negative ? -fils : fils;
}

export function filsMoney(fils: bigint): string {
  return money(Number(fils) / 1000);
}

function areaLabel(value: string | null): string {
  if (!value) return '—';
  const trimmed = value.replace(/\.0+$/, '');
  if (/^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed} م²`;
  return trimmed;
}

export function mapPropertyOption(
  dto: DealOptionPropertyApiDto,
): DealPropertyOption {
  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    area: areaLabel(dto.area),
    owner: dto.ownerName ?? '—',
    status: dto.status,
    statusLabel: PROPERTY_STATUS_LABEL[dto.status] ?? dto.status,
    available: dto.status === 'AVAILABLE',
    listingType: dto.listingType,
    suggestedEmployeeUserId: dto.suggestedEmployeeUserId ?? '',
    suggestedEmployeeName: dto.suggestedEmployeeName ?? '',
  };
}

export function mapClientOption(
  dto: DealOptionClientApiDto,
): DealClientOption {
  return {
    id: dto.id,
    name: dto.name,
    employee: dto.responsibleEmployeeName ?? '—',
    employeeUserId: dto.responsibleUserId ?? '',
  };
}

export function mapEmployeeOption(
  dto: DealOptionEmployeeApiDto,
): DealEmployeeOption {
  return { userId: dto.userId, name: dto.name };
}

/**
 * Employee attribution confirmation for the create wizard.
 *
 * OWNER keeps the existing manual confirmation workflow. MANAGER is confirmed
 * automatically, but only when the draft points at the real responsible
 * employee AND that employee is an eligible (active, in-scope) option. A stale
 * draft override or a missing/ineligible responsible employee stays
 * unconfirmed so the wizard can block it instead of inventing an employee.
 */
export function isEmployeeAttributionConfirmed({
  isOwner,
  manuallyConfirmed,
  responsibleUserId,
  attributedUserId,
  eligibleUserIds,
}: {
  isOwner: boolean;
  manuallyConfirmed: boolean;
  responsibleUserId: string | null | undefined;
  attributedUserId: string;
  eligibleUserIds: readonly string[];
}): boolean {
  if (isOwner) return manuallyConfirmed;
  return Boolean(
    responsibleUserId &&
      eligibleUserIds.includes(responsibleUserId) &&
      attributedUserId === responsibleUserId,
  );
}

export function mapDeal(dto: DealApiDto): Deal {
  return {
    id: dto.id,
    reference: dto.reference,
    propertyId: dto.property.code,
    clientId: dto.client.id,
    property: {
      id: dto.property.id,
      title: dto.property.title,
      area: areaLabel(dto.property.area),
      owner: dto.property.ownerName ?? '—',
      status: dto.property.status,
      statusLabel:
        PROPERTY_STATUS_LABEL[dto.property.status] ?? dto.property.status,
    },
    client: {
      id: dto.client.id,
      name: dto.client.name,
      employee: dto.clientEmployee?.name ?? '—',
    },
    propertyEmployee: dto.propertyEmployee?.name ?? '—',
    clientEmployee: dto.clientEmployee?.name ?? '—',
    type: DEAL_TYPE_LABEL[dto.type],
    price: Number(dto.price),
    companyCommission: Number(dto.companyCommission),
    propertyCommission: Number(dto.propertyCommission),
    clientCommission: Number(dto.clientCommission),
    priceFils: toFils(dto.price),
    companyCommissionFils: toFils(dto.companyCommission),
    propertyCommissionFils: toFils(dto.propertyCommission),
    clientCommissionFils: toFils(dto.clientCommission),
    date: dto.closedAt,
    notes: dto.notes ?? '',
    createdBy: dto.recordedBy.name,
    commissions: dto.commissions.map((row) => ({
      id: row.id,
      role: row.role,
      amount: row.amount,
      status: row.status,
      paidAt: row.paidAt,
      employeeUserId: row.employeeUserId,
    })),
  };
}
