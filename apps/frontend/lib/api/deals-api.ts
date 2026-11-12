import { authorizedRequest } from './authorized';
import type {
  CreateDealPayload,
  DealApiDto,
  DealClientOptionsPageApiDto,
  DealListApiDto,
  DealOptionsApiDto,
} from './deal-types';

const BASE = '/deals';

function queryString(query: { limit?: number; cursor?: string }): string {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const value = params.toString();
  return value ? `?${value}` : '';
}

/** `GET /deals` — authorised cursor page (OWNER company-wide, MANAGER team). */
export function listDeals(
  query: { limit?: number; cursor?: string } = {},
): Promise<DealListApiDto> {
  return authorizedRequest<DealListApiDto>(BASE + queryString(query));
}

/** `GET /deals/options` — picker data for the existing create wizard. */
export function getDealOptions(): Promise<DealOptionsApiDto> {
  return authorizedRequest<DealOptionsApiDto>(`${BASE}/options`);
}

/** `GET /deals/client-options` — server-searchable authorised client picker. */
export function searchDealClients(
  query: { search?: string; limit?: number; cursor?: string } = {},
): Promise<DealClientOptionsPageApiDto> {
  const params = new URLSearchParams();
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const suffix = params.toString();
  return authorizedRequest<DealClientOptionsPageApiDto>(
    `${BASE}/client-options${suffix ? `?${suffix}` : ''}`,
  );
}

/** `GET /deals/:id` — 404 for deals outside the viewer's scope. */
export function getDeal(id: string): Promise<DealApiDto> {
  return authorizedRequest<DealApiDto>(`${BASE}/${id}`);
}

/** `POST /deals` — transactional deal + commissions + property status. */
export function createDeal(payload: CreateDealPayload): Promise<DealApiDto> {
  return authorizedRequest<DealApiDto>(BASE, { method: 'POST', body: payload });
}
