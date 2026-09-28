import type { AuthUser } from '@arkan/shared';
import { tagForEmail } from './nfc-store';
// UI-only metadata: never stores a password or token, never grants authorization.
export function rememberAttendanceIdentity(user: AuthUser, email: string) {
  try {
    localStorage.setItem(
      `arkan:mock-attendance-identity:${user.id}`,
      email.trim().toLowerCase(),
    );
  } catch {
    /* Attendance will report unavailable identity. */
  }
}
export function attendanceIdentity(user: AuthUser) {
  const email = localStorage.getItem(
    `arkan:mock-attendance-identity:${user.id}`,
  );
  if (!email)
    throw new Error('سجّل الدخول مجددًا لتهيئة هوية الحضور التجريبية');
  return { email, name: tagForEmail(email)?.name || email };
}
