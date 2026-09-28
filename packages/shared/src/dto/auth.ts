import type { Role } from '../enums/role';
export interface AuthUser {
  id: string;
  role: Role;
}
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
