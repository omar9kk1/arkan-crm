// Owner/broker contact visibility for property screens.
//
// Business rule: a property's private owner/broker contact is visible only to
// the manager and to the employee who registered that contact. Any other
// employee sees the property's public data plus the responsible employee's name.
//
// This is now *server-authoritative*: `GET /properties/:id` and
// `GET /properties` only attach the contact when the viewer is authorized for
// it, and otherwise return the public shape with no contact fields at all. The
// helper therefore asks a single question — "did the authorized response carry
// the contact?" — instead of re-deriving ownership on the client. The UI must
// never make an extra request to recover contact data the backend withheld.
export interface PropertyContactFields {
  /** True only when the authorized backend response carried the contact. */
  hasPrivateContact?: boolean;
}

/** Whether the private owner/broker contact may be rendered for this row. */
export function canViewPropertyContact(
  property: PropertyContactFields,
): boolean {
  return property.hasPrivateContact === true;
}

/** Short role label for the property's contact: "المالك" or "الوسيط". */
export function contactRoleLabel(type?: 'OWNER' | 'BROKER'): string {
  return type === 'BROKER' ? 'الوسيط' : 'المالك';
}

/** Full contact-type label used in review/summary rows. */
export function contactTypeLabel(type?: 'OWNER' | 'BROKER'): string {
  return type === 'BROKER' ? 'وسيط عقاري' : 'مالك مباشر';
}
