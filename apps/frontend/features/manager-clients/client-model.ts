export interface FollowUp {
  id: string;
  date: string;
  employee: string;
  result: string;
  note: string;
}
export interface SuitableProperty {
  /** Stable `Property.id` when the source carried one; '' for reference-only rows. */
  id: string;
  code: string;
  title: string;
  summary: string;
  /** Separate facts the interest cards show on their own lines (optional,
   * falling back to the legacy `summary` line when absent). */
  area?: string;
  price?: string;
  /** Optional inquiry notes (real `ClientPropertyInterest` rows only). */
  notes?: string;
  /** Optional inquiry reason (real `ClientPropertyInterest` rows only). */
  reason?: string;
}
export interface OwnerEmployee {
  id: string;
  name: string;
  phone: string;
  timeline: FollowUp[];
}
export interface ClientSample {
  id: string;
  name: string;
  phone: string;
  type: string;
  employee: string;
  lastFollowUp: string;
  status: 'متابع' | 'متابعة متأخرة' | 'مفتوح';
  request: string;
  nextFollowUp: string;
  timeline: FollowUp[];
  properties: readonly SuitableProperty[];
  /**
   * Recorded interests in existing program properties (`ClientPropertyInterest`),
   * newest first; every row carries the immutable `Property.id`.
   */
  propertyInterests?: readonly ClientInterestRow[];
  notes?: string;
  requestBundle?: import('../employee-clients/components/request-wizard/client-request-bundle').ClientRequestBundle;
}
export interface ClientInterestRow {
  id: string;
  code: string;
  title: string;
  summary: string;
  reason: string;
  notes: string;
}
import { ownerTypePills } from '../../lib/contact-registry';

/** One compact transaction-type pill rendered on the owner card. */
export type OwnerTypePill = import('../../lib/contact-registry').OwnerTypePill;
export interface OwnerSample {
  id: string;
  name: string;
  phone: string;
  type: string;
  employee: string;
  lastFollowUp: string;
  status: 'متأخر' | 'متابع' | 'جديد';
  properties: readonly SuitableProperty[];
  employees: readonly OwnerEmployee[];
  /**
   * Transaction-type pills computed from the SAME authorized linked properties
   * (`Property.contactId` rows the backend returned); empty when no properties.
   */
  typePills: readonly OwnerTypePill[];
}
export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Builds the owner view model from an authorized registry contact.
 *
 * The responsible employee comes from the backend (`Contact.responsibleUserId`
 * → `User.name`, surfaced as `ownerName`): exactly one real entry when one is
 * assigned, and none at all otherwise — never a mock list. Linked properties
 * carry the stable `Property.id` (parallel to `propertyCodes`) so the owner
 * drawer can open the exact property.
 */
export function ownerFromRegistryContact(
  contact: import('../../lib/contact-registry').RegistryContact,
): OwnerSample {
  const lastFollowUp = contact.createdAt
    ? contact.createdAt.slice(0, 10)
    : 'لم تُسجل بعد';
  const responsibleName = contact.ownerName.trim();
  // `propertyIds` and `propertyCodes` are parallel arrays from the backend: each
  // linked property contributes exactly one id and one reference, in the same
  // order. A stable id that is somehow missing stays '' so the card renders
  // unclickable rather than opening the wrong property.
  const properties: SuitableProperty[] = (contact.propertyCodes ?? []).map(
    (code: string, index: number) => ({
      id: contact.propertyIds[index] ?? '',
      code,
      title: code,
      summary: '',
    }),
  );
  // One pill per transaction type, grouped from the same authorized linked
  // rows the cards already expose — no extra request and no invented count.
  // Rows without a type cannot happen on the real contract (`listingType` is
  // required), and if one ever slipped through it is skipped, never guessed.
  const typePills: readonly OwnerTypePill[] = ownerTypePills(
    contact.propertyIds.flatMap((id: string, index: number) => {
      const listingType = contact.dealTypes?.[index];
      return listingType ? [{ id, listingType }] : [];
    }),
  );
  return {
    id: `owner-${contact.id}`,
    name: contact.name,
    phone: contact.phone,
    type: contact.type === 'OWNER' ? 'مالك' : 'وسيط',
    employee: responsibleName || 'غير مُسند',
    lastFollowUp,
    status: (lastFollowUp === 'لم تُسجل بعد'
      ? 'جديد'
      : 'متابع') as OwnerSample['status'],
    properties,
    typePills,
    employees: responsibleName
      ? [
          {
            id: contact.ownerUserId || contact.id,
            name: responsibleName,
            phone: '',
            timeline: [],
          },
        ]
      : [],
  };
}
