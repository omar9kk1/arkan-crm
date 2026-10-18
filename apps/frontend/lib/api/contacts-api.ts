import { authorizedRequest } from './authorized';
import type {
  ContactDto,
  ContactPageDto,
  ContactTypeApi,
  CreateContactPayload,
  UpdateContactPayload,
} from './property-types';

const BASE = '/contacts';

export interface ListContactsQuery {
  type?: ContactTypeApi;
  limit?: number;
  cursor?: string;
}

function queryString(query: ListContactsQuery): string {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const value = params.toString();
  return value ? `?${value}` : '';
}

/** `GET /contacts` — cursor paginated, server-authorised per viewer role. */
export function listContacts(
  query: ListContactsQuery = {},
): Promise<ContactPageDto> {
  return authorizedRequest<ContactPageDto>(BASE + queryString(query));
}

/** `GET /contacts/:id` — 404 for records the viewer may not see. */
export function getContact(id: string): Promise<ContactDto> {
  return authorizedRequest<ContactDto>(`${BASE}/${id}`);
}

/** `POST /contacts` — creates an owner/broker record owned by the caller. */
export function createContact(
  payload: CreateContactPayload,
): Promise<ContactDto> {
  return authorizedRequest<ContactDto>(BASE, { method: 'POST', body: payload });
}

/** `PATCH /contacts/:id` — partial update; `notes: null` clears them. */
export function updateContact(
  id: string,
  payload: UpdateContactPayload,
): Promise<ContactDto> {
  return authorizedRequest<ContactDto>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}
