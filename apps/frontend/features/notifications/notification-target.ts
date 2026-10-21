import type { NotificationDto } from '../../lib/api/notification-types';

/**
 * URL query params honoured by the manager clients page (`/manager/clients`)
 * to open the exact drawer on the right tab — the same carry-the-id pattern
 * the properties page already uses with `PROPERTY_QUERY_PARAM`.
 */
export const MANAGER_CLIENT_CLIENT_QUERY_PARAM = 'client';
export const MANAGER_CLIENT_OWNER_QUERY_PARAM = 'owner';
export const MANAGER_CLIENT_BROKER_QUERY_PARAM = 'broker';

/**
 * Where a notification click must land, derived ONLY from the already-
 * authorized references of the notification row — never from a guessed or
 * hand-typed id. Returns null when there is nothing the recipient may open:
 * record-activity rows are delivered to managers only, and an employee
 * receiving a row without a property link has no route (no invented access).
 */
export function notificationRoute(
  item: Pick<
    NotificationDto,
    'propertyId' | 'clientId' | 'contactId' | 'contactType'
  >,
  role: string | undefined,
): { path: string } | null {
  // A property row deep-links through the existing authorized properties page.
  if (item.propertyId) {
    const base = role === 'MANAGER' ? '/manager' : '/employee';
    return {
      path: `${base}/properties?property=${encodeURIComponent(item.propertyId)}`,
    };
  }
  // Record activity is a manager-only feed: the manager is authorized for every
  // company client/contact, so the row's reference is an authorized target.
  if (role !== 'MANAGER') return null;
  if (item.clientId) {
    return {
      path: `/manager/clients?${MANAGER_CLIENT_CLIENT_QUERY_PARAM}=${encodeURIComponent(item.clientId)}`,
    };
  }
  if (item.contactId) {
    if (item.contactType !== 'OWNER' && item.contactType !== 'BROKER')
      return null;
    const param =
      item.contactType === 'OWNER'
        ? MANAGER_CLIENT_OWNER_QUERY_PARAM
        : MANAGER_CLIENT_BROKER_QUERY_PARAM;
    return {
      path: `/manager/clients?${param}=${encodeURIComponent(item.contactId)}`,
    };
  }
  return null;
}
