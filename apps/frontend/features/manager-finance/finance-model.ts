import type {
  FinanceMovementApiDto,
  FinanceSummaryApiDto,
} from '../../lib/api/finance-types';

export type MovementType = 'income' | 'commission' | 'payroll' | 'manual';
export type Currency = 'KWD' | 'EGP';
export type SourceType = 'صفقة' | 'عمولة' | 'راتب' | 'مصروف يدوي';
export type FinanceStatus =
  | 'EARNED'
  | 'PENDING'
  | 'PAID'
  | 'CANCELLED'
  | 'RECORDED';
export interface FinanceMovement {
  currency?: Currency;
  id: string;
  reference: string;
  title: string;
  type: MovementType;
  sourceType: SourceType;
  sourceId: string;
  date: string;
  amountFils: bigint;
  direction: 'داخل' | 'خارج';
  party: string;
  employee?: string;
  property?: string;
  clientOrOwner?: string;
  status: string;
  statusCode: FinanceStatus;
  calculation: readonly string[];
  notes: string;
}
export interface ManualExpenseDraft {
  currency: Currency;
  expenseType: string;
  amountFils: bigint;
  date: string;
  property: string;
  propertyId?: string;
  description: string;
}
export interface FinanceFilter {
  period: 'today' | 'week' | 'month' | 'all';
  type: MovementType | 'all';
  party: string;
  query: string;
}
export interface FinanceSummary {
  currency: Currency;
  count: number;
  income: bigint;
  commission: bigint;
  payroll: bigint;
  manual: bigint;
  pendingCommission: bigint;
  pendingPayroll: bigint;
  net: bigint;
}
export const movementLabels: Record<MovementType, string> = {
  income: 'عمولة داخلة',
  commission: 'عمولة موظف',
  payroll: 'راتب',
  manual: 'مصروف يدوي',
};
export const statusLabels: Record<FinanceStatus, string> = {
  EARNED: 'مستحقة',
  PENDING: 'بانتظار الصرف',
  PAID: 'تم الصرف',
  CANCELLED: 'ملغاة',
  RECORDED: 'مسجل',
};
export const expenseTypes = [
  'مصروف إداري',
  'تصوير عقار',
  'إعلان وتسويق',
  'صيانة',
  'أخرى',
];
export const money = (fils: bigint | number, currency: Currency = 'KWD') =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: currency === 'EGP' ? 2 : 3 }).format(Number(fils) / 1000)} ${currency === 'EGP' ? 'ج.م' : 'د.ك'}`;
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}
export function filterMovements(
  movements: readonly FinanceMovement[],
  filter: FinanceFilter,
  today = localDate(),
) {
  const start =
    filter.period === 'today'
      ? today
      : filter.period === 'week'
        ? shiftDate(today, -6)
        : filter.period === 'month'
          ? `${today.slice(0, 7)}-01`
          : '';
  const query = filter.query.trim().toLocaleLowerCase('ar');
  return movements.filter(
    (item) =>
      (!start || (item.date >= start && item.date <= today)) &&
      (filter.type === 'all' || item.type === filter.type) &&
      (!filter.party || item.party === filter.party) &&
      `${item.title} ${item.property ?? ''} ${item.employee ?? ''} ${item.party} ${item.sourceId} ${item.reference}`
        .toLocaleLowerCase('ar')
        .includes(query),
  );
}
export function summarize(
  movements: readonly FinanceMovement[],
  currency: Currency = 'KWD',
) {
  return movements
    .filter((item) => (item.currency ?? 'KWD') === currency)
    .reduce(
      (sum, item) => {
        sum[item.type] += item.amountFils;
        sum.net +=
          item.direction === 'داخل' ? item.amountFils : -item.amountFils;
        return sum;
      },
      {
        income: 0n,
        commission: 0n,
        payroll: 0n,
        manual: 0n,
        net: 0n,
      },
    );
}
/** Exact decimal string -> integer fils (KWD, 3 decimals; no floats). */
export function toFils(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const absolute = negative ? whole.slice(1) : whole;
  const fils =
    BigInt(absolute || '0') * 1000n + BigInt((fraction + '000').slice(0, 3));
  return negative ? -fils : fils;
}
/** Integer fils -> exact API decimal string (never a floating-point value). */
export function filsToAmount(fils: bigint): string {
  const negative = fils < 0n;
  const absolute = negative ? -fils : fils;
  const fraction = (absolute % 1000n)
    .toString()
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / 1000n}${fraction ? `.${fraction}` : ''}`;
}
// Store monetary values as integer fils to avoid floating-point rounding.
export function parseAmount(value: string, currency: Currency = 'KWD') {
  if (currency === 'EGP' && !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const amount = BigInt(whole || '0') * 1000n + BigInt(fraction.padEnd(3, '0'));
  return amount > 0n && amount <= 1000000000000000n ? amount : null;
}
export function manualMovement(
  draft: ManualExpenseDraft,
  id: string,
): FinanceMovement {
  return {
    id,
    reference: `FM-${id}`,
    title: draft.expenseType,
    type: 'manual',
    sourceType: 'مصروف يدوي',
    sourceId: `ME-${id}`,
    date: draft.date,
    amountFils: draft.amountFils,
    currency: draft.currency,
    direction: 'خارج',
    party: 'مصروفات الشركة',
    property: draft.property || undefined,
    status: statusLabels.RECORDED,
    statusCode: 'RECORDED',
    calculation: [
      `${draft.expenseType}: ${money(draft.amountFils, draft.currency)}`,
    ],
    notes: draft.description,
  };
}
export function totalMoney(
  movements: readonly FinanceMovement[],
  select: (totals: ReturnType<typeof summarize>) => bigint,
) {
  const currencies = [
    ...new Set(movements.map((item) => item.currency ?? 'KWD')),
  ];
  return (currencies.length ? currencies : (['KWD'] as Currency[]))
    .map((currency) => money(select(summarize(movements, currency)), currency))
    .join(' / ');
}
export function summaryMoney(
  summaries: readonly FinanceSummary[],
  select: (totals: FinanceSummary) => bigint,
) {
  return (summaries.length ? summaries : ([{ currency: 'KWD' }] as const))
    .map((summary) => {
      if (!('income' in summary)) return money(0n, 'KWD');
      return money(select(summary), summary.currency);
    })
    .join(' / ');
}
export function summaryCount(summaries: readonly FinanceSummary[]) {
  return summaries.reduce((sum, item) => sum + item.count, 0);
}

const typeByKind: Record<FinanceMovementApiDto['kind'], MovementType> = {
  deal: 'income',
  commission: 'commission',
  payroll: 'payroll',
  manual: 'manual',
};
const sourceLabels: Record<FinanceMovementApiDto['sourceType'], SourceType> = {
  DEAL: 'صفقة',
  COMMISSION: 'عمولة',
  PAYROLL: 'راتب',
  MANUAL_EXPENSE: 'مصروف يدوي',
};

/** Maps the persistent API row into the existing card/drawer view model. */
export function mapFinanceMovement(dto: FinanceMovementApiDto): FinanceMovement {
  const status = statusLabels[dto.status];
  return {
    id: dto.id,
    reference: dto.reference,
    title: dto.title,
    type: typeByKind[dto.kind],
    sourceType: sourceLabels[dto.sourceType],
    sourceId: dto.sourceId,
    date: dto.occurredAt,
    amountFils: toFils(dto.amount),
    currency: dto.currency as Currency,
    direction: dto.direction === 'INCOME' ? 'داخل' : 'خارج',
    party: dto.counterparty,
    employee: dto.employee?.name,
    property: dto.property
      ? `${dto.property.code} — ${dto.property.title}`
      : undefined,
    clientOrOwner: dto.client?.name,
    status,
    statusCode: dto.status,
    calculation: dto.calculation,
    notes: dto.notes ?? '',
  };
}

export function mapFinanceSummary(dto: FinanceSummaryApiDto): FinanceSummary {
  return {
    currency: dto.currency as Currency,
    count: dto.count,
    income: toFils(dto.income),
    commission: toFils(dto.commission),
    payroll: toFils(dto.payroll),
    manual: toFils(dto.manual),
    pendingCommission: toFils(dto.pendingCommission),
    pendingPayroll: toFils(dto.pendingPayroll),
    net: toFils(dto.net),
  };
}
