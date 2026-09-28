import type { FollowUp } from '../manager-clients/mock-data';
export interface EmployeeSample {
  email?: string;
  jobRole?: 'موظف مبيعات' | 'مدير';
  notes?: string;
  id: string;
  name: string;
  phone: string;
  active: boolean;
  hiredAt: string;
  salary: number;
  clientsCount: number;
  propertiesCount: number;
  dealsCount: number;
  commission: number;
  lateCount: number;
  clients: readonly string[];
  enteredProperties: readonly string[];
  deals: readonly { code: string; title: string; commission: number }[];
  followups: readonly FollowUp[];
}
export const employees: readonly EmployeeSample[] = [
  {
    id: 'ahmad',
    name: 'أحمد محمد',
    phone: '5000 0101',
    active: true,
    hiredAt: '2025-03-01',
    salary: 1200,
    clientsCount: 16,
    propertiesCount: 8,
    dealsCount: 5,
    commission: 2500,
    lateCount: 3,
    clients: ['محمد العتيبي', 'عبدالله سالم'],
    enteredProperties: ['K029 · المطلاع - N12', 'K0331 · غرناطة'],
    deals: [
      { code: 'D001', title: 'بيع بيت المطلاع', commission: 2000 },
      { code: 'D003', title: 'تأجير عقار غرناطة', commission: 500 },
    ],
    followups: [
      {
        id: 'a1',
        date: '2026-09-07',
        employee: 'أحمد محمد',
        result: 'متابعة متأخرة',
        note: 'تأكيد موعد المعاينة مع محمد العتيبي.',
      },
      {
        id: 'a2',
        date: '2026-09-06',
        employee: 'أحمد محمد',
        result: 'بانتظار رد المالك',
        note: 'مراجعة السعر مع أبو فهد.',
      },
    ],
  },
  {
    id: 'sara',
    name: 'سارة أحمد',
    phone: '5000 0102',
    active: true,
    hiredAt: '2025-05-12',
    salary: 1300,
    clientsCount: 12,
    propertiesCount: 6,
    dealsCount: 6,
    commission: 3100,
    lateCount: 1,
    clients: ['شركة الواحة'],
    enteredProperties: ['K0334 · غرناطة - قطعة 4'],
    deals: [
      { code: 'D002', title: 'تأجير عقار غرناطة', commission: 500 },
      { code: 'D004', title: 'بيع فيلا', commission: 2600 },
    ],
    followups: [
      {
        id: 's1',
        date: '2026-09-08',
        employee: 'سارة أحمد',
        result: 'متابعة متأخرة',
        note: 'مراجعة الخيارات المرسلة إلى شركة الواحة.',
      },
    ],
  },
  {
    id: 'khaled',
    name: 'خالد مبارك',
    phone: '5000 0103',
    active: true,
    hiredAt: '2025-01-15',
    salary: 1200,
    clientsCount: 10,
    propertiesCount: 11,
    dealsCount: 3,
    commission: 1800,
    lateCount: 2,
    clients: ['ناصر الرشيدي'],
    enteredProperties: ['K027 · بيت المطلاع', 'K041 · صباح الأحمد'],
    deals: [{ code: 'D005', title: 'بيع بيت المطلاع', commission: 1800 }],
    followups: [
      {
        id: 'k1',
        date: '2026-09-05',
        employee: 'خالد مبارك',
        result: 'متابعة متأخرة',
        note: 'متابعة الطلب الاستثماري لناصر الرشيدي.',
      },
    ],
  },
  {
    id: 'mohamed',
    name: 'محمد العتيبي',
    phone: '5000 0104',
    active: false,
    hiredAt: '2024-11-10',
    salary: 1150,
    clientsCount: 5,
    propertiesCount: 3,
    dealsCount: 1,
    commission: 600,
    lateCount: 1,
    clients: ['عميل تجريبي'],
    enteredProperties: ['K042 · صباح الأحمد'],
    deals: [{ code: 'D006', title: 'تأجير بيت', commission: 600 }],
    followups: [
      {
        id: 'm1',
        date: '2026-09-04',
        employee: 'محمد العتيبي',
        result: 'متابعة متأخرة',
        note: 'تحتاج المتابعة مراجعة المدير لأن الموظف غير نشط.',
      },
    ],
  },
];
export const assignmentProperties = [
  { id: 'K029', title: 'المطلاع - N12' },
  { id: 'K0331', title: 'غرناطة - قطعة 2' },
  { id: 'K0334', title: 'غرناطة - قطعة 4' },
  { id: 'K041', title: 'فيلا صباح الأحمد' },
];
export const assignmentTypes = [
  'تسويق فقط',
  'متابعة مالك',
  'تجهيز معاينات',
] as const;
export interface Assignment {
  employeeId: string;
  propertyId: string;
  type: (typeof assignmentTypes)[number];
  note: string;
}
export const initialAssignments: Assignment[] = [
  {
    employeeId: 'ahmad',
    propertyId: 'K029',
    type: 'متابعة مالك',
    note: 'أولوية التواصل مع المالك.',
  },
  {
    employeeId: 'sara',
    propertyId: 'K029',
    type: 'تجهيز معاينات',
    note: 'تنسيق زيارات العملاء لنفس العقار.',
  },
  { employeeId: 'khaled', propertyId: 'K041', type: 'تسويق فقط', note: '' },
];
export const money = (amount: number) =>
  `${new Intl.NumberFormat('ar-KW').format(amount)} د.ك`;
