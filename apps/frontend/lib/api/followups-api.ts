import { ApiError } from '../api-client';
import { authorizedRequest } from './authorized';
import type {
  FollowUpBatchResultDto,
  FollowUpHistoryDto,
  FollowUpListDto,
  FollowUpReminderResultDto,
  FollowUpSupervisionListDto,
  FollowUpTabApi,
} from './followup-types';

const BASE = '/follow-ups';

export type FollowUpTabQueryApi = FollowUpTabApi | 'all';
export type FollowUpStatusQueryApi =
  | 'all'
  | 'OVERDUE'
  | 'TODAY'
  | 'UPCOMING'
  | 'NEVER';

export interface FollowUpListQuery {
  search?: string;
  tab?: FollowUpTabQueryApi;
  status?: FollowUpStatusQueryApi;
  cursor?: string;
  limit?: number;
}

export interface FollowUpSupervisionQuery extends FollowUpListQuery {
  employeeUserId?: string;
}

function queryString(query: FollowUpListQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.tab && query.tab !== 'all') params.set('tab', query.tab);
  if (query.status && query.status !== 'all') {
    params.set('status', query.status);
  }
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const value = params.toString();
  return value ? `?${value}` : '';
}

/**
 * The employee follow-ups read/save paths.
 *
 * The responsible scope is ALWAYS resolved by the backend from the session —
 * nothing here sends an employee id, a due date or an author. The page simply
 * re-renders what the authorized feed returned.
 */

/** `GET /follow-ups` — the caller's OWN synchronized subjects, oldest due first. */
export function listFollowUps(
  query: FollowUpListQuery = {},
): Promise<FollowUpListDto> {
  return authorizedRequest<FollowUpListDto>(BASE + queryString(query));
}

/** `GET /follow-ups/:id/history` — ONE subject's permanent history, newest first. */
export function getFollowUpHistory(subjectId: string): Promise<FollowUpHistoryDto> {
  return authorizedRequest<FollowUpHistoryDto>(`${BASE}/${encodeURIComponent(subjectId)}/history`);
}

export interface SaveFollowUpItemInput {
  subjectId: string;
  note: string;
}

/**
 * `POST /follow-ups/batch` — ONE atomic, idempotent save of a single phone
 * conversation covering several subjects. Every submitted note must contain
 * meaningful non-whitespace text (an UNTOUCHED subject is simply not
 * submitted), and each saved subject receives its OWN permanent entry and its
 * OWN due-date reset.
 */
export function saveFollowUpBatch(
  batchId: string,
  items: SaveFollowUpItemInput[],
): Promise<FollowUpBatchResultDto> {
  return authorizedRequest<FollowUpBatchResultDto>(`${BASE}/batch`, {
    method: 'POST',
    // JSON body: `apiRequest` serialises it and sets the Content-Type itself.
    body: { batchId, items },
  });
}

/**
 * `GET /follow-ups/manager/overview` — MANAGER ONLY: the company-wide feed of
 * every EMPLOYEE-owned follow-up subject (ordered most-overdue first), each
 * with its responsible employee and the latest manual reminder instant. Never
 * reachable from an employee account.
 */
export function listSupervisionFollowUps(
  query: FollowUpSupervisionQuery = {},
): Promise<FollowUpSupervisionListDto> {
  const base = queryString(query);
  const params = new URLSearchParams(base.startsWith('?') ? base.slice(1) : base);
  if (query.employeeUserId) {
    params.set('employeeUserId', query.employeeUserId);
  }
  const value = params.toString();
  return authorizedRequest<FollowUpSupervisionListDto>(
    `${BASE}/manager/overview${value ? `?${value}` : ''}`,
  );
}

/**
 * `POST /follow-ups/:id/reminder` — MANAGER ONLY: ONE manual reminder to the
 * responsible employee of ONE overdue subject, server-side cooldown
 * deduplicated. It NEVER resets the subject's schedule; the server returns
 * `replayed: true` for a click that raced another within the same cooldown
 * window.
 */
export function sendFollowUpReminder(
  subjectId: string,
): Promise<FollowUpReminderResultDto> {
  return authorizedRequest<FollowUpReminderResultDto>(
    `${BASE}/${encodeURIComponent(subjectId)}/reminder`,
    { method: 'POST' },
  );
}

/** Server Arabic copy first, then a generic Arabic fallback. */export function followUpApiMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.messages.length)
    return cause.messages[0] ?? fallback;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}


/** `GET /follow-ups/achievements/today` ? entries authored by the caller today. */
export interface FollowUpAchievementEntryDto {
  id: string;
  subjectId: string;
  subjectLabel: string;
  createdAt: string;
}
export interface FollowUpAchievementsTodayDto {
  count: number;
  distinctSubjects: number;
  entries: FollowUpAchievementEntryDto[];
}
export function getFollowUpAchievementsToday(): Promise<FollowUpAchievementsTodayDto> {
  return authorizedRequest<FollowUpAchievementsTodayDto>(
    `${BASE}/achievements/today`,
  );
}
