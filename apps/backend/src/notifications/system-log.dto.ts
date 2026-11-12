import type { Role } from '@prisma/client';

export interface SystemLogPartyDto {
  id: string;
  name: string;
  role: Role;
}

export interface SystemLogEntityDto {
  /** Stable machine kind used by the UI (PROPERTY, CLIENT, ...). */
  type: string;
  /** Arabic display label. */
  label: string;
  id: string;
  /** Human-facing code/reference when the entity has one. */
  code: string | null;
  /** Human-facing record name/title when it has one. */
  name: string | null;
}

export interface SystemLogDetailsRefDto {
  /** Which existing read-only drawer can safely display this event. */
  type: 'CLIENT_REVIEW' | 'PROPERTY';
  /** The REAL request/property id taken from the audit row's entityId. */
  id: string;
}

export interface SystemLogEntryDto {
  id: string;
  action: string;
  /** Arabic sentence including the actor, ready to render as the row title. */
  title: string;
  /** Short factual description; never a raw audit payload. */
  description: string;
  actor: SystemLogPartyDto;
  /** Direct supervisor / decision requester, when the event has one. */
  recipients: SystemLogPartyDto[];
  entity: SystemLogEntityDto | null;
  /** Null for unrelated/deleted records; the UI must not guess a match. */
  details: SystemLogDetailsRefDto | null;
  createdAt: string;
}

export interface SystemLogPageDto {
  items: SystemLogEntryDto[];
  nextCursor: string | null;
}
