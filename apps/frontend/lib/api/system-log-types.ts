import type { Role } from '@arkan/shared';

export interface SystemLogPartyDto {
  id: string;
  name: string;
  role: Role;
}

export interface SystemLogEntityDto {
  type: string;
  label: string;
  id: string;
  code: string | null;
  name: string | null;
}

export interface SystemLogDetailsRefDto {
  type: 'CLIENT_REVIEW' | 'PROPERTY';
  id: string;
}

export interface SystemLogEntryDto {
  id: string;
  action: string;
  title: string;
  description: string;
  actor: SystemLogPartyDto;
  recipients: SystemLogPartyDto[];
  entity: SystemLogEntityDto | null;
  details: SystemLogDetailsRefDto | null;
  createdAt: string;
}

export interface SystemLogPageDto {
  items: SystemLogEntryDto[];
  nextCursor: string | null;
}
