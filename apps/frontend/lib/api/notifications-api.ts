import { authorizedRequest } from './authorized';
import type {
  NotificationPageDto,
  UnreadCountDto,
} from './notification-types';

const BASE = '/notifications';

export interface ListNotificationsQuery {
  limit?: number;
  cursor?: string;
}

function queryString(query: ListNotificationsQuery): string {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const value = params.toString();
  return value ? `?${value}` : '';
}

/**
 * `GET /notifications` — the caller's OWN inbox, newest first, cursor paginated.
 * The recipient always comes from the session token, never from the request.
 */
export function listNotifications(
  query: ListNotificationsQuery = {},
): Promise<NotificationPageDto> {
  return authorizedRequest<NotificationPageDto>(BASE + queryString(query));
}

/** `GET /notifications/unread-count` — the badge number. */
export function getUnreadNotificationCount(): Promise<UnreadCountDto> {
  return authorizedRequest<UnreadCountDto>(`${BASE}/unread-count`);
}

/** `PATCH /notifications/:id/read` — idempotent; a foreign id is a 404. */
export function markNotificationRead(
  id: string,
): Promise<{ id: string; read: true }> {
  return authorizedRequest<{ id: string; read: true }>(
    `${BASE}/${id}/read`,
    { method: 'PATCH' },
  );
}

/** `PATCH /notifications/read-all` — marks every unread row of the caller. */
export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return authorizedRequest<{ updated: number }>(`${BASE}/read-all`, {
    method: 'PATCH',
  });
}
