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
  /** Free-text search over public listing fields (code, title, area...). */
  q?: string;
  limit?: number;
  cursor?: string;
}

function queryString(query: ListPropertiesQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.listingType) params.set('listingType', query.listingType);
  if (query.q?.trim()) params.set('q', query.q.trim());
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
  idempotencyKey?: string,
): Promise<PropertyViewDto> {
  const body = new FormData();
  body.append('payload', JSON.stringify(payload));
  body.append('image', image, image.name);
  return authorizedRequest<PropertyViewDto>(BASE, {
    method: 'POST',
    formData: body,
    // Server-side idempotency: a timeout retry of the same logical operation
    // replays the committed outcome instead of creating a second property.
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

/**
 * `PATCH /properties/:id` — mandatory `version`, stale → 409.
 *
 * With a replacement image the request becomes multipart: the fields travel in
 * a `payload` JSON string (exactly like `POST /properties`) and the image in
 * the `image` field. Without an image the request stays a plain JSON body.
 */
export function updateProperty(
  id: string,
  payload: UpdatePropertyPayload,
  image?: File | null,
): Promise<PropertyViewDto> {
  if (!image) {
    return authorizedRequest<PropertyViewDto>(`${BASE}/${id}`, {
      method: 'PATCH',
      body: payload,
    });
  }
  const body = new FormData();
  body.append('version', String(payload.version));
  body.append('payload', JSON.stringify(payload));
  body.append('image', image, image.name);
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}`, {
    method: 'PATCH',
    formData: body,
  });
}

/** `POST /properties/:id/approve` — manager only. */
export function approveProperty(
  id: string,
  version: number,
  approveAsDistinct?: boolean,
): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/approve`, {
    method: 'POST',
    body: { version, approveAsDistinct },
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

export function linkPropertyToExisting(
  submittedId: string,
  existingPropertyId: string,
): Promise<void> {
  return authorizedRequest<void>(`${BASE}/${submittedId}/link-to-existing`, {
    method: 'POST',
    body: { existingPropertyId },
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


/** `GET /properties/trash` — Manager-only soft-deleted rows. */
export function listTrashedProperties(): Promise<PropertyPageDto> {
  return authorizedRequest<PropertyPageDto>(`${BASE}/trash`);
}

/** `POST /properties/:id/trash` — Manager-only soft delete (recoverable). */
export function trashProperty(
  id: string,
  reason?: string,
): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/trash`, {
    method: 'POST',
    body: { reason },
  });
}

/** `POST /properties/:id/restore` — Manager-only restore from Trash. */
export function restoreProperty(id: string): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/restore`, {
    method: 'POST',
  });
}

/** `DELETE /properties/:id/permanent` — Manager-only irreversible deep delete. */
export function permanentDeleteProperty(
  id: string,
  confirmationCode: string,
): Promise<{ id: string; reference: string }> {
  return authorizedRequest<{ id: string; reference: string }>(
    `${BASE}/${id}/permanent`,
    { method: 'DELETE', body: { confirmationCode } },
  );
}


/**
 * `GET /properties/:id/history` — read-only detail for the ORIGINAL submitter
 * of a rejected or soft-deleted property. Other employees receive 404.
 */
export function getPropertyHistory(id: string): Promise<PropertyViewDto> {
  return authorizedRequest<PropertyViewDto>(`${BASE}/${id}/history`);
}
