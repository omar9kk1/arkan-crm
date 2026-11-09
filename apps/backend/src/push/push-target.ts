import { ContactType, type NotificationType } from '@prisma/client';
import { Role } from '@arkan/shared';

/**
 * The in-app target of one notification, expressed as the SAME deep link the
 * notification bell uses, so a push click lands on exactly the record the
 * in-app row points at.
 *
 * Only the ids travel in the URL — never a name, a phone number or a note.
 */
export interface PushTargetRow {
  type: NotificationType;
  propertyId: string | null;
  clientId: string | null;
  contactId: string | null;
  contactType: ContactType | null;
  /** Deep-link target of a client review row. */
  clientReviewId?: string | null;
  /** Deep-link target of a follow-up subject (employee/manager, per role). */
  followUpSubjectId?: string | null;
  /**
   * The stored per-recipient dedup key. For `FOLLOWUP_CREATED` rows it is
   * exactly `FOLLOWUP_CREATED:<entryId>`, i.e. the authoritative entry the
   * notification reports — the deep link scrolls/highlights it.
   */
  eventKey?: string | null;
}

/** The FollowUpEntry id carried by a follow-up birth eventKey, if any. */
function followUpEntryOf(
  type: NotificationType,
  eventKey: string | null | undefined,
): string | null {
  if (type !== 'FOLLOWUP_CREATED' || !eventKey?.startsWith('FOLLOWUP_CREATED:'))
    return null;
  return eventKey.slice('FOLLOWUP_CREATED:'.length) || null;
}

/** The record-activity events, which only a manager may ever receive. */
const RECORD_EVENTS: NotificationType[] = [
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_INTEREST_UPDATED',
  'FOLLOWUP_CREATED',
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
];

export function isRecordEvent(type: NotificationType): boolean {
  return RECORD_EVENTS.includes(type);
}

/**
 * The authorized in-app route for one notification row, or null when the row
 * points at nothing openable.
 */
export function pushTargetUrl(row: PushTargetRow, role: Role): string | null {
  const management = role === Role.MANAGER || role === Role.OWNER;
  // A follow-up subject deep-links to the SAME page the in-app row points at
  // (the recipient is that subject's responsible employee, or a manager
  // monitoring it) — checked FIRST because those rows may also carry record
  // references. Only ids travel: never a name, a phone or a note.
  if (row.followUpSubjectId) {
    const base = management ? '/manager' : '/employee';
    const entryId = followUpEntryOf(row.type, row.eventKey);
    const entry = entryId
      ? `&follow-up-entry=${encodeURIComponent(entryId)}`
      : '';
    return `${base}/followups?follow-up=${encodeURIComponent(
      row.followUpSubjectId,
    )}${entry}`;
  }
  // Client review rows go to the requester (an employee) or to a manager —
  // both are authorized for the review by construction of the recipients.
  if (row.clientReviewId) {
    const reviewBase = management ? '/manager' : '/employee';
    return `${reviewBase}/clients?client-review=${encodeURIComponent(
      row.clientReviewId,
    )}`;
  }
  if (row.propertyId) {
    const base = management ? '/manager' : '/employee';
    return `${base}/properties?property=${encodeURIComponent(row.propertyId)}`;
  }
  if (row.clientId) {
    return `/manager/clients?client=${encodeURIComponent(row.clientId)}`;
  }
  if (row.contactId) {
    if (row.contactType === 'OWNER')
      return `/manager/clients?owner=${encodeURIComponent(row.contactId)}`;
    if (row.contactType === 'BROKER')
      return `/manager/clients?broker=${encodeURIComponent(row.contactId)}`;
  }
  return null;
}
