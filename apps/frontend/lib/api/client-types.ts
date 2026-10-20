/** Types mirroring the backend `GET/POST/PATCH /clients` contract. */
export interface ClientFollowUpApiDto {
  id: string;
  /** Calendar date the next contact is due (YYYY-MM-DD). */
  dueAt: string;
  /** When the entry was logged (ISO timestamp). */
  createdAt: string;
  /** Contact method (اتصال / رسالة / معاينة); empty for a scheduled entry. */
  method: string;
  /** Result of the contact; empty for a scheduled, not-yet-logged entry. */
  outcome: string;
  note: string;
  /** Display name of the employee the follow-up is assigned to. */
  employeeName: string;
}

export interface ClientPropertyApiDto {
  id: string;
  reference: string;
  title: string;
  area: string;
  askingPrice: string | null;
  currency: string;
}

/**
 * One recorded interest of the client in an EXISTING program property
 * (`ClientPropertyInterest`). Public property fields only — the backend never
 * sends private owner/broker data through this relationship.
 */
export interface ClientPropertyInterestApiDto {
  /** Immutable `Property.id` — the deep-link target, never the code. */
  propertyId: string;
  reference: string;
  title: string;
  area: string;
  askingPrice: string | null;
  currency: string;
  reason: string;
  notes: string;
  createdAt: string;
}

export interface PropertyInterestPayload {
  /** Immutable backend `Property.id` validated server-side before saving. */
  propertyId: string;
  reason?: string;
  notes?: string;
}

export interface ClientApiDto {
  id: string;
  name: string;
  phone: string;
  notes: string;
  source: string;
  status: string;
  /** Stable `User.id` of the responsible employee; null when unassigned. */
  responsibleUserId: string | null;
  responsibleEmployeeName: string | null;
  /** Stable `User.id` of the employee who registered the client. */
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Earliest pending follow-up due date (YYYY-MM-DD); null when unscheduled. */
  nextFollowUp: string | null;
  /** Follow-ups, newest first (capped in list; full in detail). */
  followUps: ClientFollowUpApiDto[];
  /** Properties linked through recorded deals. */
  properties: ClientPropertyApiDto[];
  /** Recorded interests in existing program properties, newest first. */
  propertyInterests: ClientPropertyInterestApiDto[];
}

export interface ClientListApiDto {
  items: ClientApiDto[];
}

export interface ClientStatsApiDto {
  totalClients: number;
  activeClients: number;
  owners: number;
  brokers: number;
  followUpsThisWeek: number;
  clientsNeedingFollowUp: number;
  clientsLate: number;
  clientsWithoutProperty: number;
}

export interface CreateClientPayload {
  name: string;
  phone: string;
  notes?: string;
  source?: string;
  responsibleUserId?: string;
  nextFollowUp?: string;
  /** Interests saved ATOMICALLY with the client (validated server-side). */
  propertyInterests?: PropertyInterestPayload[];
}

export interface UpdateClientPayload {
  name?: string;
  phone?: string;
  notes?: string | null;
  source?: string | null;
  responsibleUserId?: string | null;
  /** Upserted on the authorised client; repeated ids never duplicate rows. */
  propertyInterests?: PropertyInterestPayload[];
}

export interface CreateClientFollowUpPayload {
  dueAt: string;
  method: string;
  outcome: string;
  note?: string;
}

export interface ListClientsQuery {
  search?: string;
  limit?: number;
}
