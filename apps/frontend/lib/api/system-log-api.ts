import { authorizedRequest } from './authorized';
import type { SystemLogPageDto } from './system-log-types';

export interface ListSystemLogQuery {
  limit?: number;
  cursor?: string;
}

function queryString(query: ListSystemLogQuery): string {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const value = params.toString();
  return value ? `?${value}` : '';
}

/** `GET /notifications/system-log` — OWNER-only real activity log. */
export function listSystemLog(
  query: ListSystemLogQuery = {},
): Promise<SystemLogPageDto> {
  return authorizedRequest<SystemLogPageDto>(
    `/notifications/system-log${queryString(query)}`,
  );
}
