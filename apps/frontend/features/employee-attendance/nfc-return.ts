import { Role } from '@arkan/shared';
// Only this fixed same-origin route can be resumed after login.
export function nfcReturn(role: string, search: string) {
  if (role !== Role.EMPLOYEE) return null;
  const value = new URLSearchParams(search).get('returnUrl');
  if (!value) return null;
  try {
    const url = new URL(value, 'https://local.invalid');
    if (
      url.origin !== 'https://local.invalid' ||
      url.pathname !== '/employee/attendance/nfc'
    )
      return null;
    return `${url.pathname}?tag=${encodeURIComponent(url.searchParams.get('tag') || '')}`;
  } catch {
    return null;
  }
}
