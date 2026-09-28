export type AttendanceState = 'حاضر' | 'متأخر' | 'غائب' | 'إجازة';
export interface AttendanceRecord {
  method?: 'NFC' | 'MANUAL';
  date: string;
  checkIn: string;
  checkOut: string;
  status: AttendanceState;
  note: string;
}
export function localDate(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
export function duration(record: AttendanceRecord) {
  if (!record.checkIn || !record.checkOut) return '—';
  const minutes = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const total = Math.max(0, minutes(record.checkOut) - minutes(record.checkIn));
  return Math.floor(total / 60) + ' س ' + (total % 60) + ' د';
}
export function createHistory(today = localDate()): AttendanceRecord[] {
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - i - 1);
    const status: AttendanceState =
      i === 1 ? 'متأخر' : i === 2 ? 'غائب' : i === 3 ? 'إجازة' : 'حاضر';
    return {
      date: localDate(d),
      checkIn:
        status === 'غائب' || status === 'إجازة'
          ? ''
          : status === 'متأخر'
            ? '09:30'
            : '09:00',
      checkOut: status === 'غائب' || status === 'إجازة' ? '' : '17:00',
      status,
      note:
        status === 'متأخر' ? 'تأخير تجريبي يحتاج مراجعة المدير.' : 'سجل تجريبي',
    };
  });
}
export function filterHistory(
  items: AttendanceRecord[],
  period: string,
  status: string,
  today = localDate(),
) {
  const start = new Date(today + 'T12:00:00');
  start.setDate(start.getDate() - 6);
  return items.filter(
    (item) =>
      (period === 'today'
        ? item.date === today
        : period === 'week'
          ? item.date >= localDate(start) && item.date <= today
          : item.date.slice(0, 7) === today.slice(0, 7) &&
            item.date <= today) &&
      (!status || item.status === status),
  );
}
export function checkIn(
  current: AttendanceRecord | null,
  date: string,
): AttendanceRecord {
  return (
    current || {
      date,
      checkIn: '09:00',
      checkOut: '',
      status: 'حاضر',
      note: 'تسجيل تجريبي مؤقت',
    }
  );
}
export function checkOut(
  current: AttendanceRecord | null,
): AttendanceRecord | null {
  return !current || current.checkOut
    ? current
    : { ...current, checkOut: '17:00' };
}
