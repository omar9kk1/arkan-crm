import { Role, type AuthUser, type TokenPair } from '@arkan/shared';
import { apiRequest } from '../../../lib/api-client';

export interface LoginInput {
  email: string;
  password: string;
}
function validateTokens(tokens: TokenPair): TokenPair {
  if (
    !tokens ||
    typeof tokens.accessToken !== 'string' ||
    !tokens.accessToken ||
    typeof tokens.refreshToken !== 'string' ||
    !tokens.refreshToken ||
    typeof tokens.expiresIn !== 'number' ||
    tokens.expiresIn <= 0
  )
    throw new Error('استجابة جلسة غير صالحة.');
  return tokens;
}
export const roleHome = (role: Role) =>
  role === Role.MANAGER ? '/manager' : '/employee';
export async function login(input: LoginInput): Promise<TokenPair> {
  return validateTokens(
    await apiRequest<TokenPair>('/auth/login', { method: 'POST', body: input }),
  );
}
export async function getMe(accessToken: string): Promise<AuthUser> {
  const user = await apiRequest<AuthUser>('/auth/me', { accessToken });
  if (
    !user ||
    typeof user.id !== 'string' ||
    !user.id ||
    (user.role !== Role.MANAGER && user.role !== Role.EMPLOYEE)
  )
    throw new Error('استجابة مستخدم غير صالحة.');
  return user;
}
export async function refresh(refreshToken: string): Promise<TokenPair> {
  return validateTokens(
    await apiRequest<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    }),
  );
}
export function logout(refreshToken: string) {
  return apiRequest<{ loggedOut: boolean }>('/auth/logout', {
    method: 'POST',
    body: { refreshToken },
  });
}
