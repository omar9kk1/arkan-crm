import type { Role } from '../enums/role';
export interface AuthUser {
  id: string;
  role: Role;
  /**
   * The stable session lineage of the caller's current session, resolved
   * server-side from the live session row. It is NULL for sessions created
   * before the lineage existed; such sessions work normally but are never
   * eligible for device-bound features (Web Push).
   */
  sessionLineageId?: string | null;
  /**
   * Live review capabilities for the authenticated Manager. OWNER is always
   * full; EMPLOYEE is always false. These are display hints only — every
   * protected action re-checks the database row.
   */
  capabilities?: {
    approveProperties: boolean;
    rejectProperties: boolean;
  };
}
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
