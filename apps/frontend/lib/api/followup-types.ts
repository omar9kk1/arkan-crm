/**
 * Wire shapes for `GET /follow-ups`, `GET /follow-ups/:id/history` and
 * `POST /follow-ups/batch` — mirrors the backend DTOs exactly. It carries NO
 * other employee's data by construction: the backend filters every list,
 * history and save by the caller's own responsibility scope, and a foreign id
 * answers 404.
 */

/** Which tab ids the backend tabsOf() reports (the implicit «الكل» is added client-side). */
export type FollowUpTabApi =
  | 'owners'
  | 'buyers'
  | 'sellers'
  | 'renters'
  | 'lessors'
  | 'inquiries'
  | 'exchanges';

export type FollowUpSubjectKindApi =
  | 'PROPERTY_OWNER'
  | 'CLIENT_REQUEST'
  | 'INQUIRY'
  | 'CLIENT';

/** Kuwait-calendar-day due state decided by the SERVER, never the device. */
export type FollowUpBucketApi = 'OVERDUE' | 'TODAY' | 'UPCOMING';

export type FollowUpRequestTypeApi = 'BUYER' | 'RENTER' | 'EXCHANGER';

export type FollowUpPersonTypeApi = 'CONTACT' | 'OWNER' | 'CLIENT';

/** The reliable person identity a subject was derived from. */
export interface FollowUpPersonDto {
  type: FollowUpPersonTypeApi;
  id: string;
  name: string;
  phone: string;
}

export interface FollowUpLatestDto {
  note: string;
  createdAt: string;
  authorName: string | null;
}

/** The ACTUAL responsible user of a subject (employee or manager — server-derived). */
export interface FollowUpResponsibleDto {
  userId: string;
  name: string;
}

export interface FollowUpSubjectDto {
  id: string;
  kind: FollowUpSubjectKindApi;
  requestType: FollowUpRequestTypeApi | null;
  label: string;
  tabs: FollowUpTabApi[];
  person: FollowUpPersonDto | null;
  propertyId: string | null;
  propertyReference: string | null;
  propertyTitle: string | null;
  area: string | null;
  clientId: string | null;
  /** Next due instant (UTC ISO) — the server is the single source of truth. */
  dueAt: string;
  bucket: FollowUpBucketApi;
  /** The actual responsible user for this subject (never a client claim). */
  responsible: FollowUpResponsibleDto | null;
  /** null = «لم تتم متابعتها» yet. */
  lastSavedAt: string | null;
  entryCount: number;
  latest: FollowUpLatestDto | null;
}

export interface FollowUpSummaryApiDto {
  total: number;
  overdue: number;
  today: number;
  upcoming: number;
  never: number;
  tabs: Record<'all' | FollowUpTabApi, number>;
}

export interface FollowUpListDto {
  items: FollowUpSubjectDto[];
  nextCursor: string | null;
  /** Backward-compatible alias for `nextCursor !== null`. */
  truncated: boolean;
  generatedAt: string;
  /** Full-scope counters; present on the first page only. */
  summary?: FollowUpSummaryApiDto;
}

/**
 * ONE subject in the manager's SUPERVISION feed (متابعات الموظفين): an
 * EMPLOYEE-owned subject enriched with its responsible employee name and the
 * latest manual reminder instant (the cooldown state). This shape can never
 * appear on an employee account — the endpoint is manager-only.
 */
export interface FollowUpSupervisionSubjectDto extends FollowUpSubjectDto {
  responsible: FollowUpResponsibleDto;
  lastReminderAt: string | null;
}

export interface FollowUpSupervisionListDto {
  items: FollowUpSupervisionSubjectDto[];
  nextCursor: string | null;
  /** Backward-compatible alias for `nextCursor !== null`. */
  truncated: boolean;
  generatedAt: string;
}

export interface FollowUpResponsiblePageDto {
  items: FollowUpResponsibleDto[];
  nextCursor: string | null;
}

/** The result of ONE manual manager reminder (sent or replayed, with cooldown). */
export interface FollowUpReminderResultDto {
  subjectId: string;
  recipientUserId: string;
  recipientName: string;
  sentAt: string;
  cooldownUntil: string;
  /** True when a concurrent click in the same window already sent it. */
  replayed: boolean;
}

/** ONE permanent append-only history entry (never editable or deletable). */
export interface FollowUpEntryDto {
  id: string;
  note: string;
  authorName: string | null;
  createdAt: string;
  /** Shared conversation id — correlates a batch WITHOUT merging histories. */
  batchId: string | null;
  prevDueAt: string | null;
  /** The due date this note produced (server timestamp + interval). */
  nextDueAt: string | null;
}

export interface FollowUpHistoryDto {
  subject: FollowUpSubjectDto;
  entries: FollowUpEntryDto[];
}

export interface FollowUpBatchResultDto {
  /** True when this exact batch was already committed and simply replayed. */
  replayed: boolean;
  savedCount: number;
  saved: Array<{ subjectId: string; entryId: string; nextDueAt: string }>;
}
