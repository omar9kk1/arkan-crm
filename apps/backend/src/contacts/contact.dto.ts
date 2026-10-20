import { ContactType, DealType } from '@prisma/client';

/**
 * A property linked to a contact (`Property.contactId`), as far as the viewer is
 * authorized to see it. References only — enough for the Clients screens to count
 * and list a contact's properties (and group them by `Property.listingType`)
 * without receiving full property rows.
 */
export interface ContactPropertyRefDto {
  id: string;
  reference: string;
  /**
   * The linked property's real transaction type (`DealType`). Required on every
   * `Property` row, so grouped pill counts can never be invented client-side:
   * the sum of the type counts always equals `properties.length`.
   */
  listingType: DealType;
}

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
  /**
   * Display name of the responsible employee, read from the related
   * `User.name` through `Contact.responsibleUserId`; null for a company record
   * with no responsible user. Server-derived — never the owner's own name.
   */
  responsibleEmployeeName: string | null;
  /**
   * Properties linked to this contact (`Property.contactId`), restricted to the
   * same visibility rule as `GET /properties`: the manager sees every linked
   * property; an employee only sees the linked properties they may access. The
   * count displayed in the UI is `properties.length` — never a client-side guess.
   */
  properties: ContactPropertyRefDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ContactPageDto {
  items: ContactDto[];
  nextCursor: string | null;
}
