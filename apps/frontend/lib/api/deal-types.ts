/** Types mirroring the backend `GET/POST /deals` contract. */

export type DealTypeApi = 'SALE' | 'RENT' | 'EXCHANGE';
export type DealPropertyStatusApi =
  | 'PENDING'
  | 'AVAILABLE'
  | 'REJECTED'
  | 'SOLD'
  | 'RENTED'
  | 'ARCHIVED';

export interface DealPartyApiDto {
  userId: string;
  name: string;
}

export interface DealPropertyApiDto {
  id: string;
  /** Display code: approved A-code when present, otherwise the P-code. */
  code: string;
  title: string;
  /** Square meters when known, otherwise the area label. */
  area: string | null;
  ownerName: string | null;
  status: DealPropertyStatusApi;
  listingType: DealTypeApi;
}

export interface DealCommissionApiDto {
  /** Stable Commission id used by the payout endpoint. */
  id: string;
  role: 'PROPERTY_EMPLOYEE' | 'CLIENT_EMPLOYEE' | 'MANUAL';
  /** Exact decimal string (3 decimals, KWD). */
  amount: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  /** Calendar date (YYYY-MM-DD) once paid, otherwise null. */
  paidAt: string | null;
  employeeUserId: string;
}

export interface DealApiDto {
  id: string;
  reference: string;
  type: DealTypeApi;
  /** Exact decimal strings; never parsed as floats by the API. */
  price: string;
  companyCommission: string;
  propertyCommission: string;
  clientCommission: string;
  currency: string;
  /** Calendar date (YYYY-MM-DD). */
  closedAt: string;
  createdAt: string;
  property: DealPropertyApiDto;
  client: { id: string; name: string };
  propertyEmployee: DealPartyApiDto | null;
  clientEmployee: DealPartyApiDto | null;
  recordedBy: { name: string };
  notes: string | null;
  commissions: DealCommissionApiDto[];
}

export interface DealListApiDto {
  items: DealApiDto[];
  nextCursor: string | null;
}

export interface DealOptionPropertyApiDto {
  id: string;
  code: string;
  title: string;
  area: string | null;
  ownerName: string | null;
  status: DealPropertyStatusApi;
  listingType: DealTypeApi;
  suggestedEmployeeUserId: string | null;
  suggestedEmployeeName: string | null;
}

export interface DealOptionClientApiDto {
  id: string;
  name: string;
  responsibleUserId: string | null;
  responsibleEmployeeName: string | null;
}

export interface DealOptionEmployeeApiDto {
  userId: string;
  name: string;
}

export interface DealOptionsApiDto {
  properties: DealOptionPropertyApiDto[];
  clients: DealOptionClientApiDto[];
  employees: DealOptionEmployeeApiDto[];
}

export interface DealClientOptionsPageApiDto {
  items: DealOptionClientApiDto[];
  nextCursor: string | null;
}

export interface CreateDealPayload {
  propertyId: string;
  clientId: string;
  propertyEmployeeUserId: string;
  clientEmployeeUserId: string;
  type: 'SALE' | 'RENT';
  /** Exact decimal strings validated server-side (max 3 decimals, KWD fils). */
  price: string;
  companyCommission: string;
  propertyCommission: string;
  clientCommission: string;
  closedAt: string;
  notes?: string;
}
