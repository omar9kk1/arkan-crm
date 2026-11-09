import { authorizedRequest } from './authorized';
import type {
  ClientApiDto,
  ClientFollowUpApiDto,
  ClientListApiDto,
  ClientRecommendationCandidateListApiDto,
  ClientStatsApiDto,
  CreateClientFollowUpPayload,
  CreateClientPayload,
  ListClientsQuery,
  UpdateClientPayload,
} from './client-types';

const BASE = '/clients';

function queryString(query: ListClientsQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.filter) params.set('filter', query.filter);
  if (query.classification) params.set('classification', query.classification);
  const value = params.toString();
  return value ? `?${value}` : '';
}

/** `GET /clients` — authorised list, optionally searched and limited. */
export function listClients(
  query: ListClientsQuery = {},
): Promise<ClientListApiDto> {
  return authorizedRequest<ClientListApiDto>(BASE + queryString(query));
}

/**
 * `GET /clients/recommendation-candidates` — all eligible clients in the
 * viewer's scope, not just the first list page.
 */
export function listClientRecommendationCandidates(): Promise<ClientRecommendationCandidateListApiDto> {
  return authorizedRequest<ClientRecommendationCandidateListApiDto>(
    `${BASE}/recommendation-candidates`,
  );
}

/** `GET /clients/stats` — authorised counters for summary cards and tab badges. */
export function getClientStats(): Promise<ClientStatsApiDto> {
  return authorizedRequest<ClientStatsApiDto>(`${BASE}/stats`);
}

/** `GET /clients/:id` — full detail (includes uncapped follow-up log). */
export function getClient(id: string): Promise<ClientApiDto> {
  return authorizedRequest<ClientApiDto>(`${BASE}/${id}`);
}

/** `POST /clients` — creates an authorised client (+ optional first follow-up). */
export function createClient(
  payload: CreateClientPayload,
): Promise<ClientApiDto> {
  return authorizedRequest<ClientApiDto>(BASE, { method: 'POST', body: payload });
}

/** `PATCH /clients/:id` — edits an authorised client. */
export function updateClient(
  id: string,
  payload: UpdateClientPayload,
): Promise<ClientApiDto> {
  return authorizedRequest<ClientApiDto>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

/** `POST /clients/:id/follow-ups` — logs a contact against an authorised client. */
export function createClientFollowUp(
  clientId: string,
  payload: CreateClientFollowUpPayload,
): Promise<ClientFollowUpApiDto> {
  return authorizedRequest<ClientFollowUpApiDto>(
    `${BASE}/${clientId}/follow-ups`,
    {
      method: 'POST',
      body: payload,
    },
  );
}
