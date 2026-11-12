/** Types mirroring the OWNER-only `/finance` backend contract. */

export type FinanceMovementApiType = 'income' | 'commission' | 'payroll' | 'manual';
export type FinancePeriodApi = 'today' | 'week' | 'month' | 'all';
export type FinanceStatusApi =
  | 'EARNED'
  | 'PENDING'
  | 'PAID'
  | 'CANCELLED'
  | 'RECORDED';

export interface FinancePropertyApiDto {
  id: string;
  code: string;
  title: string;
}

export interface FinanceMovementApiDto {
  id: string;
  reference: string;
  kind: 'deal' | 'commission' | 'payroll' | 'manual';
  sourceType: 'DEAL' | 'COMMISSION' | 'PAYROLL' | 'MANUAL_EXPENSE';
  sourceId: string;
  direction: 'INCOME' | 'EXPENSE';
  /** Exact decimal string, never a JSON float. */
  amount: string;
  currency: string;
  /** Calendar date (YYYY-MM-DD). */
  occurredAt: string;
  createdAt: string;
  title: string;
  counterparty: string;
  status: FinanceStatusApi;
  property: FinancePropertyApiDto | null;
  client: { id: string; name: string } | null;
  employee: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  calculation: string[];
  notes: string | null;
  dealId: string | null;
  commissionId: string | null;
  manualExpenseId: string | null;
}

export interface FinanceSummaryApiDto {
  currency: string;
  count: number;
  income: string;
  commission: string;
  payroll: string;
  manual: string;
  pendingCommission: string;
  pendingPayroll: string;
  net: string;
}

export interface FinanceLedgerApiDto {
  items: FinanceMovementApiDto[];
  nextCursor: string | null;
  summaries: FinanceSummaryApiDto[];
  parties: string[];
}

export interface FinanceOptionsApiDto {
  properties: FinancePropertyApiDto[];
}

export interface CreateManualExpensePayload {
  type: string;
  /** Exact decimal string. */
  amount: string;
  currency: 'KWD' | 'EGP';
  date: string;
  propertyId?: string;
  description: string;
  /** Client-generated idempotency key. */
  requestId: string;
}

export interface CommissionPayoutApiDto {
  commissionId: string;
  status: 'PAID';
  amount: string;
  currency: string;
  paidAt: string;
  paidBy: { id: string; name: string } | null;
  movement: FinanceMovementApiDto;
}
