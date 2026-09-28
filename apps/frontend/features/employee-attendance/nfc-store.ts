import { localDate } from './model';
export const ATTENDANCE_KEY = 'arkan:mock-attendance-records';
export const employeeAttendanceTags = [
  {
    email: 'employee@arkan.test',
    tagId: 'EMP-EMPLOYEE-001',
    employeeId: 'ahmed',
    profileId: 'ahmad',
    name: 'أحمد محمد',
  },
  {
    email: 'sara@arkan.test',
    tagId: 'EMP-SARA-001',
    employeeId: 'sara',
    profileId: 'sara',
    name: 'سارة أحمد',
  },
  {
    email: 'mohamed@arkan.test',
    tagId: 'EMP-MOHAMED-001',
    employeeId: 'mohamed',
    profileId: 'mohamed',
    name: 'محمد العتيبي',
  },
];
export const tagForEmail = (email: string) =>
  employeeAttendanceTags.find((t) => t.email === email.trim().toLowerCase());
export const nfcHref = (tag: string) =>
  `/employee/attendance/nfc?tag=${encodeURIComponent(tag)}`;
export interface MockAttendance {
  id: string;
  employeeEmail: string;
  employeeName: string;
  tagId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE';
  method: 'NFC' | 'MANUAL';
  notes: string;
}
export function readAttendance(): MockAttendance[] {
  const raw = localStorage.getItem(ATTENDANCE_KEY);
  if (!raw) return [];
  const records: unknown = JSON.parse(raw);
  if (
    !Array.isArray(records) ||
    records.some(
      (r) =>
        !r ||
        ![
          'id',
          'employeeEmail',
          'employeeName',
          'tagId',
          'date',
          'checkIn',
          'checkOut',
          'notes',
        ].every((k) => typeof r[k] === 'string') ||
        !['PRESENT', 'LATE', 'ABSENT', 'LEAVE'].includes(r.status) ||
        !['NFC', 'MANUAL'].includes(r.method),
    )
  )
    throw new Error('تعذر قراءة سجل الحضور المحلي');
  return records;
}
export function saveAttendance(records: MockAttendance[]) {
  localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event('arkan:attendance-updated'));
}
// MOCK ONLY: production must validate tag ownership against JWT in backend and audit every scan.
export function registerAttendance(
  records: MockAttendance[],
  user: { email: string; name: string },
  tag: string,
  now = new Date(),
  method: 'NFC' | 'MANUAL' = 'NFC',
) {
  const mapping = employeeAttendanceTags.find((t) => t.tagId === tag);
  if (method === 'NFC' && !mapping) throw new Error('كارت الحضور غير معروف');
  if (method === 'NFC' && mapping?.email !== user.email.trim().toLowerCase())
    throw new Error('هذا الكارت غير مرتبط بحسابك');
  const email = user.email.trim().toLowerCase();
  const date = localDate(now);
  const current = records.find(
    (r) => r.employeeEmail === email && r.date === date,
  );
  if (current?.checkOut || (current && !current.checkIn))
    return { records, record: current, action: 'COMPLETED' as const };
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const record: MockAttendance = current
    ? { ...current, checkOut: time }
    : {
        id: `attendance-${email}-${date}`,
        employeeEmail: email,
        employeeName: user.name,
        tagId: tag,
        date,
        checkIn: time,
        checkOut: '',
        status: time > '09:15' ? 'LATE' : 'PRESENT',
        method,
        notes: 'تسجيل تجريبي محلي',
      };
  return {
    records: [record, ...records.filter((r) => r.id !== record.id)],
    record,
    action: current ? ('CHECK_OUT' as const) : ('CHECK_IN' as const),
  };
}
