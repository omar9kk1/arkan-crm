export interface Property {
  details?: import('../../lib/property-details').PropertyDetails;
  requestDraft?: import('./components/property-request-model').PropertyRequestDraft;
  id: string;
  code: string;
  title: string;
  owner: string;
  phone: string;
  ownerNotes: string;
  operation: string;
  region: string;
  address: string;
  area: string;
  rooms: string;
  price: string;
  description: string;
  status: string;
  mine: boolean;
  assignment: string;
  managerNotes: string;
  followers: { name: string; entries: { date: string; note: string }[] }[];
  /** Object URL of the single mandatory image (frontend-only; not persistent). */
  imageUrl?: string;
  /** Stable AuthUser.id of the employee who registered the property contact. */
  ownerUserId?: string;
  /** Display name of the responsible employee (shown when contact is private). */
  responsibleName?: string;
  /**
   * Server-derived role of the property creator (`null` when unknown); drives
   * the top-left responsible pill together with `responsibleName`.
   */
  responsibleRole?: import('../../lib/api/property-types').ResponsibleRoleApi | null;
  /** Whether the private contact is a direct owner or a broker. */
  contactType?: 'OWNER' | 'BROKER';
  /** Backend status enum; present when the row came from the API. */
  apiStatus?: import('../../lib/api/property-types').PropertyStatusApi;
  /**
   * Latest review state; present only on the authorized private response. Lets
   * the UI tell an ordinary PENDING row apart from a CHANGES_REQUESTED one.
   */
  reviewStatus?: import('../../lib/api/property-types').ApprovalStatusApi | null;
  /** Optimistic-concurrency token required by PATCH / approve / reject. */
  version?: number;
  /** Storage key of the single stored image, or null when the row has none. */
  primaryImageUrl?: string | null;
  /**
   * True only when the *authorized backend response* carried the private
   * owner/broker contact. Server-authoritative: the UI must not show contact
   * fields for another employee's AVAILABLE property.
   */
  hasPrivateContact?: boolean;
  /**
   * `Contact.id` already linked to this property, present only when the
   * authorized response carried it (manager, or the creator who owns the
   * contact). Used to keep editing on the same contact instead of creating a
   * duplicate; `null`/absent always means "no authorized linked contact".
   */
  linkedContactId?: string | null;
}
export const empty: Property = {
  id: '',
  code: '',
  title: '',
  owner: '',
  phone: '',
  ownerNotes: '',
  operation: 'بيع',
  region: '',
  address: '',
  area: '',
  rooms: '',
  price: '',
  description: '',
  status: 'بانتظار الموافقة',
  mine: true,
  assignment: '',
  managerNotes: '',
  followers: [{ name: 'أحمد محمد', entries: [] }],
};
export const owners = [
  { name: 'أبو فهد', phone: '6666 1122' },
  { name: 'أم عبدالله', phone: '6666 2233' },
];
export const tabs = [
  { id: 'all', label: 'كل العقارات' },
  { id: 'mine', label: 'عقاراتي' },
  { id: 'assigned', label: 'مخصصة لي' },
  { id: 'review', label: 'تحت المراجعة' },
  { id: 'changes', label: 'مطلوب تعديل' },
];
export const samples: Property[] = Array.from({ length: 6 }, (_, i) => ({
  ...empty,
  id: `p${i}`,
  code: `K033${i + 1}`,
  title: i % 2 ? 'بيت المطلاع' : 'دور غرناطة',
  owner: 'أبو فهد',
  phone: '6666 1122',
  region: i % 2 ? 'مدينة المطلاع' : 'غرناطة',
  address: 'قطعة 2، شارع 10',
  area: '400',
  rooms: '5 غرف',
  price: i % 2 ? '290000' : '2000',
  operation: i % 2 ? 'بيع' : 'إيجار',
  description: 'عقار جاهز للمعاينة — بيانات تجريبية.',
  status: [
    'معتمد',
    'بانتظار الموافقة',
    'مطلوب تعديل',
    'تم البيع',
    'تم التأجير',
    'معتمد',
  ][i]!,
  mine: i < 3,
  assignment:
    i === 0
      ? 'تسويق فقط'
      : i === 4
        ? 'متابعة مالك'
        : i === 5
          ? 'تجهيز معاينات'
          : '',
  managerNotes:
    i === 2 ? 'يرجى توضيح المساحة وتحديث العنوان قبل إعادة الإرسال.' : '',
  followers: [
    {
      name: 'أحمد محمد',
      entries: [{ date: '2026-09-07', note: 'تأكيد إتاحة العقار للمعاينة.' }],
    },
    {
      name: 'سارة أحمد',
      entries: [{ date: '2026-09-08', note: 'مراجعة السعر مع المالك.' }],
    },
  ],
}));
/**
 * Approved per-tab visibility rules (frontend filtering only).
 *
 * The server already returns, for an employee: every AVAILABLE property plus the
 * employee's OWN `PENDING`/`REJECTED` rows (never another employee's pending
 * work — those are authorized only to their creator and the manager). These
 * rules then narrow the loaded rows per tab:
 *
 * - `all`      → AVAILABLE only (approved inventory; review items excluded).
 * - `mine`     → AVAILABLE rows created by the viewer (`isMine`).
 * - `review`   → every authorized unapproved row of the viewer: PENDING (with
 *                any review state, so CHANGES_REQUESTED counts as unapproved
 *                too) and REJECTED. Approved rows never belong here.
 * - `changes`  → unchanged: the narrower subset the viewer still has to correct.
 * - `assigned` → unchanged (the backend has no assignment field yet).
 *
 * The rules key off the backend `status` enum (`apiStatus`) — never the
 * localized `status` label — and off `reviewStatus`, which distinguishes an
 * ordinary PENDING row from one the manager sent back for changes. This does NOT
 * change authorization: a manager keeps seeing (and acting on) the same pending
 * rows through the manager approvals workflow.
 */
export function matchesTab(p: Property, tab: string): boolean {
  switch (tab) {
    case 'all':
      return p.apiStatus === 'AVAILABLE';
    case 'mine':
      return p.apiStatus === 'AVAILABLE' && p.mine === true;
    case 'assigned':
      return !!p.assignment;
    case 'review':
      // Every authorized unapproved row: still awaiting a decision, sent back
      // for changes, or rejected — the status badge on each card keeps telling
      // them apart, so nothing here is relabelled as pending again.
      return (
        p.mine === true &&
        (p.apiStatus === 'PENDING' || p.apiStatus === 'REJECTED')
      );
    case 'changes':
      return (
        p.mine === true &&
        (p.apiStatus === 'REJECTED' ||
          (p.apiStatus === 'PENDING' &&
            p.reviewStatus === 'CHANGES_REQUESTED'))
      );
    default:
      return false;
  }
}

export function filterProperties(
  items: Property[],
  tab: string,
  query: string,
) {
  const q = query.trim().toLocaleLowerCase('ar');
  return items.filter(
    (p) =>
      matchesTab(p, tab) &&
      `${p.title} ${p.region} ${p.code}`.toLocaleLowerCase('ar').includes(q),
  );
}
export function validate(p: Property, step: number) {
  if (!p.owner.trim() || !p.phone.trim()) return 'أدخل اسم المالك والهاتف.';
  if (
    step > 0 &&
    (!p.title.trim() ||
      !p.region.trim() ||
      !p.address.trim() ||
      !p.rooms.trim() ||
      !Number.isFinite(Number(p.area)) ||
      Number(p.area) <= 0 ||
      !Number.isFinite(Number(p.price)) ||
      Number(p.price) <= 0)
  )
    return 'راجع بيانات العقار والمساحة والسعر.';
  return '';
}
