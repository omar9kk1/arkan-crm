// Static UI samples. Counts in the header reproduce the prototype, not this sample size.
export interface FollowUp {
  id: string;
  date: string;
  employee: string;
  result: string;
  note: string;
}
export interface SuitableProperty {
  code: string;
  title: string;
  summary: string;
}
export interface ClientSample {
  requestBundle?: import('../employee-clients/components/request-wizard/client-request-bundle').ClientRequestBundle;
  notes?: string;
  id: string;
  name: string;
  phone: string;
  type: string;
  employee: string;
  lastFollowUp: string;
  status: 'متابع' | 'متابعة متأخرة' | 'مفتوح';
  request: string;
  nextFollowUp: string;
  timeline: readonly FollowUp[];
  properties: readonly SuitableProperty[];
}
export interface OwnerEmployee {
  id: string;
  name: string;
  timeline: readonly FollowUp[];
}
export interface OwnerSample {
  id: string;
  name: string;
  phone: string;
  lastFollowUp: string;
  status: 'متابع' | 'متأخر' | 'جديد';
  properties: readonly SuitableProperty[];
  employees: readonly OwnerEmployee[];
}
export const clients: readonly ClientSample[] = [
  {
    id: 'client-mohamed',
    name: 'محمد العتيبي',
    phone: '5000 0001',
    type: 'شراء',
    employee: 'أحمد محمد',
    lastFollowUp: '2026-09-07',
    status: 'متابعة متأخرة',
    request: 'طلب شراء بيت في المطلاع بحدود 300 ألف د.ك.',
    nextFollowUp: '2026-09-08',
    timeline: [
      {
        id: 'c1-2',
        date: '2026-09-07',
        employee: 'أحمد محمد',
        result: 'بانتظار تحديد موعد',
        note: 'العميل مهتم بالمعاينة ويحتاج تأكيد توفر العقار.',
      },
      {
        id: 'c1-1',
        date: '2026-09-05',
        employee: 'أحمد محمد',
        result: 'تم تحديد الطلب',
        note: 'بيت عائلي في المطلاع، بميزانية تقريبية 300 ألف د.ك.',
      },
    ],
    properties: [
      {
        code: 'K029',
        title: 'المطلاع - N12',
        summary: '400 م² · 3 أدوار · مناسب للطلب التجريبي',
      },
    ],
  },
  {
    id: 'client-waha',
    name: 'شركة الواحة',
    phone: '5000 0002',
    type: 'إيجار',
    employee: 'سارة أحمد',
    lastFollowUp: '2026-09-09',
    status: 'متابع',
    request: 'استفسار عن إيجار عقار في غرناطة بمدخل مستقل.',
    nextFollowUp: '2026-09-12',
    timeline: [
      {
        id: 'c2-1',
        date: '2026-09-09',
        employee: 'سارة أحمد',
        result: 'تم إرسال الخيارات',
        note: 'أُرسلت تفاصيل العقارات المتاحة للعميل للمراجعة.',
      },
    ],
    properties: [
      {
        code: 'K0331',
        title: 'غرناطة - قطعة 2',
        summary: '420 م² · دور ونصف · معاينة مطابقة فقط',
      },
    ],
  },
  {
    id: 'client-nasser',
    name: 'ناصر الرشيدي',
    phone: '5000 0003',
    type: 'استثمار',
    employee: 'خالد مبارك',
    lastFollowUp: '2026-09-05',
    status: 'مفتوح',
    request: 'عقار زاوية مناسب للاستثمار، جاهز عند توفر فرصة مناسبة.',
    nextFollowUp: 'لم يُحدد بعد',
    timeline: [
      {
        id: 'c3-1',
        date: '2026-09-05',
        employee: 'خالد مبارك',
        result: 'استقبال طلب جديد',
        note: 'طلب مقارنة فرص استثمارية قبل تحديد الميزانية النهائية.',
      },
    ],
    properties: [],
  },
];
export const owners: readonly OwnerSample[] = [
  {
    id: 'owner-fahd',
    name: 'أبو فهد',
    phone: '6000 0001',
    lastFollowUp: '2026-09-03',
    status: 'متأخر',
    properties: [
      { code: 'K027', title: 'بيت المطلاع', summary: '400 م² · 3 أدوار' },
      { code: 'K029', title: 'المطلاع - N12', summary: '400 م² · للبيع' },
    ],
    employees: [
      {
        id: 'ahmad',
        name: 'أحمد محمد',
        timeline: [
          {
            id: 'o1-a1',
            date: '2026-09-03',
            employee: 'أحمد محمد',
            result: 'بانتظار تحديث السعر',
            note: 'طلب المالك الرجوع إليه بعد مراجعة السعر. توجد متابعة متأخرة.',
          },
          {
            id: 'o1-a0',
            date: '2026-09-01',
            employee: 'أحمد محمد',
            result: 'تم تأكيد البيانات',
            note: 'مراجعة المساحة وبيانات العقارين مع المالك.',
          },
        ],
      },
      {
        id: 'sara',
        name: 'سارة أحمد',
        timeline: [
          {
            id: 'o1-s1',
            date: '2026-09-02',
            employee: 'سارة أحمد',
            result: 'تنسيق معاينة',
            note: 'المتابعة خاصة بموعد زيارة عميل لعقار K029.',
          },
        ],
      },
    ],
  },
  {
    id: 'owner-salem',
    name: 'سالم عبدالله',
    phone: '6000 0002',
    lastFollowUp: '2026-09-08',
    status: 'متابع',
    properties: [
      { code: 'K041', title: 'فيلا صباح الأحمد', summary: '500 م² · للإيجار' },
    ],
    employees: [
      {
        id: 'sara',
        name: 'سارة أحمد',
        timeline: [
          {
            id: 'o2-s1',
            date: '2026-09-08',
            employee: 'سارة أحمد',
            result: 'تم تأكيد التوفر',
            note: 'المالك أكد إمكانية المعاينة هذا الأسبوع.',
          },
        ],
      },
    ],
  },
  {
    id: 'owner-mona',
    name: 'منى سالم',
    phone: '6000 0003',
    lastFollowUp: '2026-09-08',
    status: 'جديد',
    properties: [
      {
        code: 'R202',
        title: 'غرناطة - قطعة 3',
        summary: '420 م² · تحت المراجعة',
      },
    ],
    employees: [
      {
        id: 'khaled',
        name: 'خالد مبارك',
        timeline: [
          {
            id: 'o3-k1',
            date: '2026-09-08',
            employee: 'خالد مبارك',
            result: 'فتح ملف مالك',
            note: 'تم استلام البيانات الأولية، وفي انتظار استكمال الصور.',
          },
        ],
      },
    ],
  },
];
export function matchesPerson(
  person: { name: string; phone: string },
  query: string,
) {
  const normalize = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase('ar')
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[\s()+-]/g, '');
  return normalize(`${person.name} ${person.phone}`).includes(normalize(query));
}
