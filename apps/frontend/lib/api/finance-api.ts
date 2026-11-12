import { authorizedRequest } from './authorized';
import type {
  CommissionPayoutApiDto,
  CreateManualExpensePayload,
  FinanceLedgerApiDto,
  FinanceMovementApiDto,
  FinanceOptionsApiDto,
  FinancePeriodApi,
  FinanceMovementApiType,
} from './finance-types';

export interface FinanceQuery {
  period?: FinancePeriodApi;
  type?: FinanceMovementApiType | 'all';
  party?: string;
  query?: string;
  limit?: number;
  cursor?: string;
}

function queryString(query: FinanceQuery): string {
  const params = new URLSearchParams();
  if (query.period) params.set('period', query.period);
  if (query.type && query.type !== 'all') params.set('type', query.type);
  if (query.party) params.set('party', query.party);
  if (query.query) params.set('query', query.query);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const value = params.toString();
  return value ? `?${value}` : '';
}

/** `GET /finance` — OWNER-only persistent ledger page. */
export function listFinance(query: FinanceQuery = {}): Promise<FinanceLedgerApiDto> {
  return authorizedRequest<FinanceLedgerApiDto>(`/finance${queryString(query)}`);
}

/** `GET /finance/options` — real property picker for manual expenses. */
export function getFinanceOptions(): Promise<FinanceOptionsApiDto> {
  return authorizedRequest<FinanceOptionsApiDto>('/finance/options');
}

/** `POST /finance/manual-expenses` — idempotent manual expense + movement. */
export function createManualExpense(
  payload: CreateManualExpensePayload,
): Promise<FinanceMovementApiDto> {
  return authorizedRequest<FinanceMovementApiDto>('/finance/manual-expenses', {
    method: 'POST',
    body: payload,
  });
}

/** `POST /finance/commissions/:id/pay` — OWNER payout confirmation. */
export function confirmCommissionPayout(
  commissionId: string,
  paidAt: string,
): Promise<CommissionPayoutApiDto> {
  return authorizedRequest<CommissionPayoutApiDto>(
    `/finance/commissions/${encodeURIComponent(commissionId)}/pay`,
    { method: 'POST', body: { paidAt } },
  );
}
