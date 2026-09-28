export type Kind = 'عميل' | 'مالك' | 'عقار';
export interface Entry {
  date: string;
  result: string;
  note: string;
  next: string;
}
export interface Followup {
  id: string;
  name: string;
  phone: string;
  property: string;
  kind: Kind;
  due: string;
  reason: string;
  note: string;
  complete: boolean;
  history: Entry[];
}
export const targets = [
  {
    id: 'c1',
    kind: 'عميل' as Kind,
    name: 'محمد العتيبي',
    phone: '5000 0001',
    property: '',
  },
  {
    id: 'o1',
    kind: 'مالك' as Kind,
    name: 'أبو فهد',
    phone: '6666 1122',
    property: 'بيت المطلاع K027',
  },
  {
    id: 'p1',
    kind: 'عقار' as Kind,
    name: 'بيت المطلاع K027',
    phone: '6666 1122',
    property: 'بيت المطلاع K027',
  },
];
export function localDate(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
export function state(f: Followup, now = new Date()) {
  return f.complete ? 'مكتملة' : new Date(f.due) < now ? 'متأخرة' : 'قادمة';
}
export function createSamples(): Followup[] {
  return [0, 1, 2, 3].map((i) => {
    const target = targets[i % 3]!;
    const d = new Date();
    d.setDate(d.getDate() + [0, -2, 2, -1][i]!);
    d.setHours(15, 30, 0, 0);
    return {
      ...target,
      id: 'f' + i,
      due: localDate(d) + 'T15:30',
      reason: 'متابعة العرض وتأكيد موعد المعاينة',
      note: 'بيانات تجريبية للموظف أحمد محمد',
      complete: i === 3,
      history: [
        {
          date: '2026-09-07T10:00',
          result: 'تم التواصل',
          note: 'تم إرسال تفاصيل العرض.',
          next: localDate(d) + 'T15:30',
        },
      ],
    };
  });
}
export interface Filters {
  period: string;
  kind: string;
  status: string;
  query: string;
}
export function filterItems(items: Followup[], f: Filters, now = new Date()) {
  const today = localDate(now),
    start = new Date(now);
  start.setDate(start.getDate() - 6);
  return items.filter((item) => {
    const day = item.due.slice(0, 10);
    return (
      (f.period === 'all' ||
        (f.period === 'today' && day === today) ||
        (f.period === 'week' && day >= localDate(start) && day <= today) ||
        (f.period === 'month' && day.slice(0, 7) === today.slice(0, 7))) &&
      (!f.kind || item.kind === f.kind) &&
      (!f.status || state(item, now) === f.status) &&
      [item.name, item.property].join(' ').includes(f.query.trim())
    );
  });
}
export function recordResult(
  f: Followup,
  result: string,
  note: string,
  next: string,
  complete: boolean,
): Followup {
  return {
    ...f,
    complete,
    due: next || f.due,
    history: [
      { date: new Date().toISOString(), result, note, next },
      ...f.history,
    ],
  };
}
