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
export function pushTargetUrl(
  row: PushTargetRow,
  role: Role,
): string | null {
  if (row.propertyId) {
    const base = role === Role.MANAGER ? '/manager' : '/employee';
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
