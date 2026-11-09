/**
 * Explicit projections of the client contract.
 *
 * Every relationship answer is computed from real rows: the responsible
 * employee is a stable `User.id` plus the display name, follow-ups come from
 * `FollowUp` rows and the linked properties come from recorded `Deal` rows.
 * Nothing here may carry a password hash, an email, or any owner/broker
 * private contact field — client endpoints never read the `Contact` table for
 * record payloads (only the stats endpoint counts owner/broker rows).
 */

/** One `FollowUp` entry as the client screens consume it. */
export interface ClientFollowUpDto {
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

/** A property linked to the client through a recorded deal. */
export interface ClientPropertyDto {
  id: string;
  reference: string;
  title: string;
  area: string;
  askingPrice: string | null;
  currency: string;
}

export interface ClientDto {
  id: string;
  name: string;
  phone: string;
  notes: string;
  source: string;
  status: string;
  /**
   * The structured wizard request document (opaque JSON string packed/owned by
   * the frontend) or null when the row predates it or has no structured
   * request — treated as "no structured request recorded yet".
   */
  requestData: string | null;
  /** Stable `User.id` of the responsible employee; null when unassigned. */
  responsibleUserId: string | null;
  responsibleEmployeeName: string | null;
  /** Stable `User.id` of the employee who registered the client. */
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Earliest pending follow-up due date (YYYY-MM-DD); null when unscheduled. */
  nextFollowUp: string | null;
  /** Newest logged follow-ups first (capped in list responses, see service). */
  followUps: ClientFollowUpDto[];
  /** Properties linked through recorded deals. */
  properties: ClientPropertyDto[];
  /**
   * Recorded interests in EXISTING program properties (`ClientPropertyInterest`
   * rows), newest first. Carries PUBLIC property fields only — never the
   * owner/broker contact — exactly like the deal-linked projections above.
   */
  propertyInterests: ClientPropertyInterestDto[];
}

/**
 * One recorded client interest. The property projection is the same public
 * shape as `ClientPropertyDto`; these are inquiries (`reason`/`notes`), not
 * closed deals.
 */
export interface ClientPropertyInterestDto {
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

/**
 * Lightweight row for `GET /clients`. It intentionally carries NO follow-up,
 * deal or interest collections; those are loaded by `GET /clients/:id` when
 * the details drawer opens. The scalar summaries below are enough for the
 * cards, tabs and classifications.
 */
export interface ClientListItemDto {
  id: string;
  name: string;
  phone: string;
  notes: string;
  source: string;
  status: string;
  requestData: string | null;
  responsibleUserId: string | null;
  responsibleEmployeeName: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Earliest pending follow-up due date (YYYY-MM-DD). */
  nextFollowUp: string | null;
  /** Newest logged follow-up, flattened for the card summary. */
  lastFollowUpAt: string | null;
  lastFollowUpOutcome: string;
  lastFollowUpNote: string;
  lastFollowUpEmployeeName: string | null;
  /** Deal-linked property count (the card classification uses presence). */
  propertiesCount: number;
  /** Recorded `ClientPropertyInterest` count. */
  propertyInterestsCount: number;
}

export interface ClientListDto {
  items: ClientListItemDto[];
  /** Pass back as `cursor` to fetch the next page; null on the last page. */
  nextCursor: string | null;
}

/**
 * Minimal candidate projection for the employee property-recommendation
 * matcher. Only clients with a structured request document can participate.
 * No phone/notes/relations are exposed, and the response is not limited to the
 * client-list page size.
 */
export interface ClientRecommendationCandidateDto {
  id: string;
  name: string;
  requestData: string | null;
}

export interface ClientRecommendationCandidateListDto {
  items: ClientRecommendationCandidateDto[];
}

/**
 * Authorised counters behind the summary cards. Every number is computed from
 * the whole authorised table — never from one loaded page — so the UI can
 * render these values instead of inventing a baseline.
 */
export interface ClientStatsDto {
  /** All clients the viewer may see. */
  totalClients: number;
  /** Clients not marked closed/inactive in `Client.status`. */
  activeClients: number;
  /** Owner contacts (employee-registered) the viewer may see. */
  owners: number;
  /** Broker contacts the viewer may see. */
  brokers: number;
  /** Follow-ups due in the current Saturday–Friday week, viewer-scoped. */
  followUpsThisWeek: number;
  /** Clients with nothing scheduled beyond today (or nothing scheduled). */
  clientsNeedingFollowUp: number;
  /** Clients whose earliest pending follow-up is already in the past. */
  clientsLate: number;
  /** Clients with no recorded deal linking a property. */
  clientsWithoutProperty: number;
}
