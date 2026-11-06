// Type definitions for the manager property surfaces.
//
// The former `programProperties` / `approvalProperties` UI fixtures were removed
// once the manager screens read real rows from `GET /properties`; nothing here
// creates or represents a domain record.
export type PropertyStatus =
  | 'معتمد'
  | 'بانتظار الموافقة'
  | 'مطلوب تعديل'
  | 'مؤرشف'
  | 'تم البيع'
  | 'تم التأجير';

export interface EmployeeFollowups {
  id: string;
  name: string;
  entries: readonly { date: string; note: string }[];
}

export interface PreviewProperty {
  details?: import('../../lib/property-details').PropertyDetails;
  requestDraft?: import('../employee-properties/components/property-request-model').PropertyRequestDraft;
  /** Backend id; present when the row came from the API. */
  id?: string;
  code: string;
  /** Location identity fields (for duplicate comparison). */
  governorate?: string | null;
  district?: string | null;
  block?: string | null;
  plotNumber?: string | null;
  address?: string | null;
  title: string;
  region: string;
  price: string;
  area: number;
  rooms: string;
  status: PropertyStatus;
  owner: string;
  description: string;
  employees: readonly EmployeeFollowups[];
  /** Object URL of the single image (frontend-only; not persistent). */
  imageUrl?: string;
  /** Stable AuthUser.id of the employee who registered the contact. */
  ownerUserId?: string;
  /** Display name of the responsible employee. */
  responsibleName?: string;
  /**
   * Server-derived role of the property creator (`null` when unknown); drives
   * the top-left responsible pill together with `responsibleName`.
   */
  responsibleRole?: import('../../lib/api/property-types').ResponsibleRoleApi | null;
  /** Whether the private contact is a direct owner or a broker. */
  contactType?: 'OWNER' | 'BROKER';
  /** Storage key of the single stored image, or null when the row has none. */
  primaryImageUrl?: string | null;
  /** True only when the authorized backend response carried private contact. */
  hasPrivateContact?: boolean;
  /** Backend status enum; present when the row came from the API. */
  apiStatus?: import('../../lib/api/property-types').PropertyStatusApi;
  /**
   * Latest review state; present only on the authorized private response. Lets
   * the manager queue exclude a PENDING row whose changes were requested.
   */
  reviewStatus?: import('../../lib/api/property-types').ApprovalStatusApi | null;
  /** Optimistic-concurrency token required by approve / reject. */
  version?: number;
  /** Manager-only: possible duplicate candidate property IDs. */
  duplicateCandidateIds?: string[] | null;
  /** Trash metadata (present only on soft-deleted rows). */
  deletedAt?: string | null;
  deletedByName?: string | null;
  deletionReason?: string | null;
}

export interface ApprovalProperty extends PreviewProperty {
  submittedBy: string;
  submissionNote: string;
}
