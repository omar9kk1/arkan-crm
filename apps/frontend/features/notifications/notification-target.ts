import type { NotificationDto } from '../../lib/api/notification-types';

/**
 * URL query params honoured by the manager clients page (`/manager/clients`)
 * to open the exact drawer on the right tab — the same carry-the-id pattern
 * the properties page already uses with `PROPERTY_QUERY_PARAM`.
 */
export const MANAGER_CLIENT_CLIENT_QUERY_PARAM = 'client';
export const MANAGER_CLIENT_OWNER_QUERY_PARAM = 'owner';
export const MANAGER_CLIENT_BROKER_QUERY_PARAM = 'broker';
export const CLIENT_REVIEW_QUERY_PARAM = 'client-review';
/** Query param of the follow-up subject deep link on `/employee/followups`. */
export const FOLLOW_UP_SUBJECT_QUERY_PARAM = 'follow-up';
/** Query param of the exact FollowUpEntry a notification reports (scroll/highlight). */
export const FOLLOW_UP_ENTRY_QUERY_PARAM = 'follow-up-entry';

/** The FollowUpEntry id inside a `FOLLOWUP_CREATED:<entryId>` eventKey. */
function followUpEntryOf(eventKey: string | null | undefined): string | null {
  if (!eventKey?.startsWith('FOLLOWUP_CREATED:')) return null;
  return eventKey.slice('FOLLOWUP_CREATED:'.length) || null;
}

/**
 * Where a notification click must land, derived ONLY from the already-
 * authorized references of the notification row — never from a guessed or
 * hand-typed id. Client review rows carry NO record references at all: they
 * deep-link to the staged tab, which is authorized for BOTH roles by
 * construction of the recipients (manager submissions, requester decisions).
 */
export function notificationRoute(
  item: Pick<
    NotificationDto,
    | 'propertyId'
    | 'clientId'
    | 'contactId'
    | 'contactType'
    | 'clientReviewId'
    | 'followUpSubjectId'
    | 'eventKey'
  >,
  role: string | undefined,
): { path: string } | null {
  const management = role === 'MANAGER' || role === 'OWNER';
  // A follow-up subject deep-links to the caller's OWN follow-ups page
  // (employee → his personal board; manager → the monitoring section),
  // which opens the EXACT subject's history — checked FIRST because those
  // rows also reference a property. The id is only ever set for a recipient
  // authorized for the subject (the responsible employee, or the monitoring
  // manager for the rows addressed to him), so the link can never carry
  // someone else's data.
  if (item.followUpSubjectId) {
    const base = management ? '/manager' : '/employee';
    const entryId = followUpEntryOf(item.eventKey);
    const entry = entryId
      ? `&${FOLLOW_UP_ENTRY_QUERY_PARAM}=${encodeURIComponent(entryId)}`
      : '';
    return {
      path: `${base}/followups?${FOLLOW_UP_SUBJECT_QUERY_PARAM}=${encodeURIComponent(
        item.followUpSubjectId,
      )}${entry}`,
    };
  }
  // A property row deep-links through the existing authorized properties page.
  if (item.propertyId) {
    const base = management ? '/manager' : '/employee';
    const decision =
      item.eventKey?.startsWith('PROPERTY_REJECTED:') ||
      item.eventKey?.startsWith('PROPERTY_TRASHED:');
    return {
      path: `${base}/properties?property=${encodeURIComponent(
        item.propertyId,
      )}${decision ? '&decision=1' : ''}`,
    };
  }
  // A review row never leaks record ids: it opens the staged-reviews tab.
  if (item.clientReviewId) {
    const base = management ? '/manager' : '/employee';
    return {
      path: `${base}/clients?${CLIENT_REVIEW_QUERY_PARAM}=${encodeURIComponent(
        item.clientReviewId,
      )}`,
    };
  }
  // Record activity is a manager-only feed: the manager is authorized for every
  // company client/contact, so the row's reference is an authorized target.
  if (!management) return null;
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
