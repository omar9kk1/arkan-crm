export type MovementType = 'income' | 'commission' | 'payroll' | 'manual';
export type Currency = 'KWD' | 'EGP';
export type SourceType = 'صفقة' | 'عمولة' | 'راتب' | 'مصروف يدوي';
export interface FinanceMovement {
  currency?: Currency;
  id: string;
  reference: string;
  title: string;
  type: MovementType;
  sourceType: SourceType;
  sourceId: string;
  date: string;
  amountFils: number;
  direction: 'داخل' | 'خارج';
  party: string;
  employee?: string;
  property?: string;
  clientOrOwner?: string;
  status: string;
  calculation: readonly string[];
  notes: string;
}
export interface ManualExpenseDraft {
  currency: Currency;
  expenseType: string;
  amountFils: number;
  date: string;
  property: string;
  description: string;
}
export const movementLabels: Record<MovementType, string> = {
  income: 'عمولة داخلة',
  commission: 'عمولة موظف',
  payroll: 'راتب',
  manual: 'مصروف يدوي',
};
export const expenseTypes = [
  'مصروف إداري',
  'تصوير عقار',
  'إعلان وتسويق',
  'صيانة',
  'أخرى',
];
export const propertyOptions = [
  'المطلاع K027',
  'غرناطة K0331',
  'صباح الأحمد K041',
];
export const money = (fils: number, currency: Currency = 'KWD') =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: currency === 'EGP' ? 2 : 3 }).format(fils / 1000)} ${currency === 'EGP' ? 'ج.م' : 'د.ك'}`;
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}
export interface FinanceFilter {
  period: 'today' | 'week' | 'month' | 'all';
  type: MovementType | 'all';
  party: string;
  query: string;
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
      { income: 0, commission: 0, payroll: 0, manual: 0, net: 0 },
    );
}
// Store monetary values as integer fils to avoid floating-point rounding in the preview.
export function parseAmount(value: string, currency: Currency = 'KWD') {
  if (currency === 'EGP' && !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 1000000000000
    ? amount
    : null;
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
    status: 'مسجل تجريبيًا',
    calculation: [
      `${draft.expenseType}: ${money(draft.amountFils, draft.currency)}`,
    ],
    notes: draft.description,
  };
}
export function totalMoney(
  movements: readonly FinanceMovement[],
  select: (totals: ReturnType<typeof summarize>) => number,
) {
  const currencies = [
    ...new Set(movements.map((item) => item.currency ?? 'KWD')),
  ];
  return (currencies.length ? currencies : (['KWD'] as Currency[]))
    .map((currency) => money(select(summarize(movements, currency)), currency))
    .join(' / ');
}
