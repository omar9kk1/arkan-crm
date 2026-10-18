import type { NotificationType } from '@prisma/client';

/**
 * The exact `Notification` columns the API is allowed to read. Declared
 * explicitly so a response can never grow into a raw Prisma entity or start
 * leaking a recipient id, a relation or a private field.
 */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  propertyId: string | null;
}

/**
 * Privacy-safe shape returned to the OWNING user only.
 *
 * `message` is the stored `body`; the recipient (`userId`) is never echoed back
 * because it is always the authenticated caller. `propertyId` is nulled by the
 * serializer when the caller is not authorized to open the linked property, so
 * the UI can never render a link to a record it cannot read.
 */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
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

export function toNotificationDto(
  row: NotificationRow,
  propertyId: string | null,
): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.body,
    propertyId,
    read: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
