import { authorizedRequest } from './authorized';
import type {
  CreatePropertyPayload,
  PropertyPageDto,
  PropertyStatusApi,
  PropertyViewDto,
  DealType,
  UpdatePropertyPayload,
} from './property-types';

const BASE = '/properties';

export interface ListPropertiesQuery {
  status?: PropertyStatusApi;
  listingType?: DealType;
  limit?: number;
  cursor?: string;
}

function queryString(query: ListPropertiesQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.listingType) params.set('listingType', query.listingType);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const value = params.toString();
  return value ? `?${value}` : '';
}

/** `GET /properties` — cursor paginated; the backend is the source of truth. */
export function listProperties(
  query: ListPropertiesQuery = {},
): Promise<PropertyPageDto> {
  return authorizedRequest<PropertyPageDto>(BASE + queryString(query));
}

/** `GET /properties/:id` — 404 for records the viewer may not see. */
export function getProperty(id: string): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}`);
}

/**
 * `POST /properties` — multipart with exactly one `image` file and a `payload`
 * JSON string. The `Content-Type` (and its boundary) is left to the browser.
 */
export function createProperty(
  payload: CreatePropertyPayload,
  image: File,
): Promise<PropertyViewDto> {
  const body = new FormData();
  body.append('payload', JSON.stringify(payload));
  body.append('image', image, image.name);
  return authorizedRequest<PropertyViewDto>(BASE, {
    method: 'POST',
    formData: body,
  });
}

/** `PATCH /properties/:id` — JSON body, mandatory `version`, stale → 409. */
export function updateProperty(
  id: string,
  payload: UpdatePropertyPayload,
): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

/** `POST /properties/:id/approve` — manager only. */
export function approveProperty(
  id: string,
  version: number,
): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/approve`, {
    method: 'POST',
    body: { version },
  });
}

/** `POST /properties/:id/reject` — manager only, `reason` is mandatory. */
export function rejectProperty(
  id: string,
  reason: string,
  version: number,
): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/reject`, {
    method: 'POST',
    body: { reason, version },
  });
}

/**
 * `POST /properties/:id/request-changes` — manager only, `reason` is mandatory.
 * Keeps the property PENDING while marking the current review CHANGES_REQUESTED,
 * so it is NOT a rejection and must never be routed to `/reject`.
 */
export function requestChangesProperty(
  id: string,
  reason: string,
  version: number,
): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/request-changes`, {
    method: 'POST',
    body: { reason, version },
  });
}

/** `POST /properties/:id/resubmit` — creator only, REJECTED/CHANGES_REQUESTED → PENDING. */
export function resubmitProperty(id: string): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/resubmit`, {
    method: 'POST',
  });
}

/**
 * `GET /properties/:id/image` — authenticated, raw bytes (not the `{data}`
 * envelope). The caller owns the returned `Blob` lifecycle; the token is sent
 * only as a header, never appended to the URL.
 */
export function getPropertyImage(id: string): Promise<Blob> {
  return authorizedRequest<Blob>(`${BASE}/${id}/image`, {
    responseType: 'blob',
  });
}
