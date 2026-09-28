export const employees = [
  { id: 'ahmed', name: 'أحمد محمد' },
  { id: 'sara', name: 'سارة أحمد' },
  { id: 'khaled', name: 'خالد مبارك' },
  { id: 'mohamed', name: 'محمد العتيبي' },
];
export const statuses = {
  present: 'حاضر',
  late: 'متأخر',
  absent: 'غائب',
  leave: 'إجازة',
};
export type AttendanceStatus = keyof typeof statuses;
export interface AttendanceRecord {
  id: string;
  employeeName?: string;
  method?: 'NFC' | 'MANUAL';
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  status: AttendanceStatus;
  note: string;
}
export interface AttendanceFilter {
  date: string;
  period: 'today' | 'week' | 'month';
  employeeId: string;
  status: AttendanceStatus | '';
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function priorDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export function workedMinutes(record: AttendanceRecord) {
  if (
    record.status === 'absent' ||
    record.status === 'leave' ||
    !record.checkIn ||
    !record.checkOut
  )
    return 0;
  return Math.max(0, minutes(record.checkOut) - minutes(record.checkIn));
}
export const hoursLabel = (value: number) =>
  `${Math.floor(value / 60)} س ${value % 60} د`;
export function validateRecord(
  record: AttendanceRecord,
  records: readonly AttendanceRecord[],
) {
  if (!employees.some((e) => e.id === record.employeeId) || !record.date)
    return 'اختر الموظف والتاريخ.';
  if (
    records.some(
      (r) => r.employeeId === record.employeeId && r.date === record.date,
    )
  )
    return 'يوجد سجل لهذا الموظف في هذا التاريخ. اختر تاريخًا آخر.';
  if (record.status === 'present' || record.status === 'late') {
    if (!record.checkIn) return 'أدخل وقت الحضور.';
    if (record.checkOut && minutes(record.checkOut) <= minutes(record.checkIn))
      return 'وقت الانصراف يجب أن يكون بعد الحضور في نفس اليوم.';
  }
  return '';
}
export function filterRecords(
  records: readonly AttendanceRecord[],
  filter: AttendanceFilter,
) {
  const start =
    filter.period === 'week'
      ? priorDate(filter.date, 6)
      : filter.period === 'month'
        ? `${filter.date.slice(0, 7)}-01`
        : filter.date;
  return records.filter(
    (r) =>
      r.date >= start &&
      r.date <= filter.date &&
      (!filter.employeeId || r.employeeId === filter.employeeId) &&
      (!filter.status || r.status === filter.status),
  );
}
export function createMockRecords(date = today()): AttendanceRecord[] {
  return Array.from({ length: 8 }, (_, day) =>
    employees.map((employee, index): AttendanceRecord => {
      const status: AttendanceStatus =
        index === 2
          ? 'late'
          : index === 3
            ? day % 2
              ? 'leave'
              : 'absent'
            : 'present';
      return {
        id: `sample-${day}-${employee.id}`,
        employeeId: employee.id,
        date: priorDate(date, day),
        status,
        checkIn:
          status === 'present' ? '09:00' : status === 'late' ? '09:30' : '',
        checkOut: index < 3 ? '17:00' : '',
        note:
          status === 'late' ? 'تأخير يحتاج مراجعة؛ لا توجد خصومات محسوبة.' : '',
      };
    }),
  ).flat();
}
