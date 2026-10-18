/**
 * Wire shapes for the in-app notification bell.
 *
 * Mirrors the backend `NotificationDto` exactly. It deliberately carries NO
 * recipient id and no contact/owner field: the API only ever returns the
 * caller's own, already-privacy-filtered rows.
 */
export type NotificationTypeApi =
  | 'PROPERTY_SUBMITTED'
  | 'PROPERTY_CHANGES_REQUESTED'
  | 'PROPERTY_REJECTED'
  | 'PROPERTY_RESUBMITTED'
  | 'PROPERTY_APPROVED'
  | 'PROPERTY_AVAILABLE'
  | 'SYSTEM';

export interface NotificationDto {
  id: string;
  type: NotificationTypeApi;
  title: string;
  message: string;
  /** Authorized property to open, or null when the reader may not open it. */
  propertyId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  nextCursor: string | null;
}

export interface UnreadCountDto {
  count: number;
}
