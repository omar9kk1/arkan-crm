# NFC Attendance — Frontend mock

## Current behavior
- Route: `/employee/attendance/nfc?tag=EMP-EMPLOYEE-001`.
- No NFC browser API, server endpoint, database write, or dependency was added.
- Uses existing role guards and layouts. Logged-out scans return through login to the fixed NFC route only; external return URLs are rejected.
- Existing auth response has only user ID and role. After successful login, the login UI stores a mock email association keyed by that ID (no password/token). Existing sessions must sign in once again to initialize this metadata. Authentication itself is unchanged.
- Tag ownership is compared against that association, never inferred from the scanned tag or employee display name.
- Local records: `arkan:mock-attendance-records`. Times and dates use the device local clock; after 09:15 is LATE.
- The current history entry remembers its result so refreshing the result screen does not immediately check out. Return to attendance and open the scan link again for the next scan.
- Employee manual actions use the same local record. Existing manager manual entry/sample behavior remains intact.
- Manager merges local records with existing samples, replacing matching employee/day samples, and retains date/status/employee filters plus registration-method filter.

## Test
1. Sign in as `employee@arkan.test` / `ChangeMe123!`.
2. Open `/employee/attendance`, click «تجربة تسجيل NFC».
3. Check greeting, successful check-in and time. Refresh this result: it must not check out.
4. Return to attendance: check the record, NFC method and today's totals.
5. Open NFC again: check-out; a third visit reports the completed day without duplication.
6. Try missing tag, `UNKNOWN`, and `EMP-SARA-001`: reject without writing records.
7. Sign in as manager in the same browser/origin and inspect `/manager/attendance`, its filters, and employee details NFC section.
8. Logged out, open the NFC link and sign in as employee: resume that link.
9. Check narrow mobile width and blocked localStorage: display an error instead of a false success.

Automated logic tests: `node scripts/test-nfc-attendance.cjs`.
TypeScript and ESLint checked separately. No physical phone/NFC or browser visual test was performed.

## Limitations and security
MOCK ONLY. localStorage is editable, not an authorization/security boundary. No reliable cross-tab locking, cross-device sync, server clock, auditing, or payroll integration. Employee and manager see the same records only in the same browser profile and origin; localhost and LAN IP have separate stores. Blocking/clearing storage removes this mock's persistence. History-entry deduplication is UI protection, not production idempotency. Example tag mappings follow the existing sample employee names. Unmapped employees are shown as unlinked. Manager accounts cannot scan an employee-only route.

## Future implementation (documentation only)
Database: `EmployeeProfile.attendanceTagId` (unique).

API: `POST /attendance/nfc-scan`

Request:
```json
{ "tagId": "EMP-AHMED-001" }
```

Backend:
- Resolve current user from verified JWT, find employee profile.
- Compare stored tagId with submitted tagId; reject mismatch. Never trust frontend validation.
- In an atomic operation, first scan creates checkIn; next scan sets checkOut; completed day returns already completed.
- Define timezone/work hours and idempotency/debounce rules to avoid duplicate scans across devices.
- Record every scan in AuditLog, including rejections.

Response:
```json
{ "message": "تم تسجيل الحضور بنجاح", "action": "CHECK_IN", "record": {} }
```

## Changed files
- apps/frontend/app/employee/attendance/nfc/page.tsx
- apps/frontend/features/employee-attendance/nfc-store.ts
- apps/frontend/features/employee-attendance/use-attendance.ts
- apps/frontend/features/employee-attendance/mock-identity.ts
- apps/frontend/features/employee-attendance/nfc-return.ts
- apps/frontend/features/employee-attendance/model.ts
- apps/frontend/features/employee-attendance/components/nfc-page.tsx
- apps/frontend/features/employee-attendance/components/employee-attendance-page.tsx
- apps/frontend/features/employee-attendance/components/attendance-history-card.tsx
- apps/frontend/features/employee-attendance/components/attendance-today-card.tsx
- apps/frontend/features/manager-attendance/attendance-model.ts
- apps/frontend/features/manager-attendance/components/attendance-page.tsx
- apps/frontend/features/manager-attendance/components/attendance-card.tsx
- apps/frontend/features/manager-employees/components/employee-details-drawer.tsx
- apps/frontend/features/auth/components/login-form.tsx (UI metadata and return routing only)
- apps/frontend/features/auth/components/require-role.tsx (NFC return routing only)
- scripts/test-nfc-attendance.cjs
- docs/NFC_ATTENDANCE_PLAN.md
