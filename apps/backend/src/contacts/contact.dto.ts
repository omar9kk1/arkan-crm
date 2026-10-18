import { ContactType } from '@prisma/client';

/**
 * Explicit response shape for a contact. Contacts are private records; this DTO is
 * only ever returned to an actor already authorized for the row.
 */
export interface ContactDto {
  id: string;
  type: ContactType;
  name: string;
  phone: string;
  notes: string | null;
  responsibleUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactPageDto {
  items: ContactDto[];
  nextCursor: string | null;
}
