export interface FollowUp {
  id: string;
  date: string;
  type: string;
  result: string;
  note: string;
  next: string;
}
export interface SuitableProperty {
  name: string;
  area: string;
  price: string;
}
export interface EmployeeClient {
  requestBundle?: import('./components/request-wizard/client-request-bundle').ClientRequestBundle;
  requestDraft?: import('./components/request-wizard/client-request-model').ClientRequestDraft;
  id: string;
  name: string;
  phone: string;
  type: string;
  area: string;
  budget: string;
  notes: string;
  next: string;
  history: FollowUp[];
  properties: SuitableProperty[];
}
export const requestTypes = ['شراء', 'إيجار', 'استثمار'];
export const tabs = [
  { id: 'all', label: 'كل العملاء' },
  { id: 'today', label: 'متابعة اليوم' },
  { id: 'late', label: 'متأخر' },
  { id: 'unmatched', label: 'بدون عقار مناسب' },
];
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const isLate = (c: EmployeeClient, today = localDate()) =>
  Boolean(c.next && c.next < today);
export const clientStatus = (c: EmployeeClient) =>
  isLate(c) ? 'متأخر' : !c.properties.length ? 'بدون عقار مناسب' : 'نشط';
export function filterClients(
  items: EmployeeClient[],
  tab: string,
  query: string,
  today = localDate(),
) {
  const q = query.trim().toLocaleLowerCase('ar');
  return items.filter(
    (c) =>
      (tab === 'all' ||
        (tab === 'today' && c.next === today) ||
        (tab === 'late' && isLate(c, today)) ||
        (tab === 'unmatched' && !c.properties.length)) &&
      `${c.name} ${c.phone} ${c.type}`.toLocaleLowerCase('ar').includes(q),
  );
}
export function createClients(): EmployeeClient[] {
  return [
    {
      id: 'c1',
      name: 'محمد العتيبي',
      phone: '5000 0001',
      type: 'شراء',
      area: 'مدينة المطلاع',
      budget: '300000',
      notes: 'يفضل بيتًا جاهزًا للسكن.',
      next: localDate(),
      history: [
        {
          id: 'f1',
          date: '2026-09-07',
          type: 'اتصال',
          result: 'مهتم بالعرض',
          note: 'طلب تحديد موعد للمعاينة.',
          next: localDate(),
        },
      ],
      properties: [
        {
          name: 'بيت المطلاع K027',
          area: 'مدينة المطلاع',
          price: '290,000 د.ك',
        },
      ],
    },
    {
      id: 'c2',
      name: 'سارة سالم',
      phone: '5000 0002',
      type: 'إيجار',
      area: 'غرناطة',
      budget: '2000',
      notes: 'تفضل دورًا مستقلًا.',
      next: '2026-09-01',
      history: [
        {
          id: 'f2',
          date: '2026-08-30',
          type: 'رسالة',
          result: 'بانتظار صور العقار',
          note: 'المتابعة مستحقة.',
          next: '2026-09-01',
        },
      ],
      properties: [
        { name: 'دور غرناطة K0331', area: 'غرناطة', price: '2,000 د.ك / شهر' },
      ],
    },
    {
      id: 'c3',
      name: 'عبدالله علي',
      phone: '5000 0003',
      type: 'استثمار',
      area: 'صباح الأحمد',
      budget: '450000',
      notes: 'يبحث عن فرصة استثمارية طويلة الأجل.',
      next: '',
      history: [],
      properties: [],
    },
  ];
}
