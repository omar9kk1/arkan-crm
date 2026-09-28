// UI fixtures only. No domain records or persistence are created here.
export type PropertyStatus =
  'معتمد' | 'بيع' | 'إيجار' | 'تم البيع' | 'تم التأجير' | 'بانتظار الموافقة';
export interface EmployeeFollowups {
  id: string;
  name: string;
  entries: readonly { date: string; note: string }[];
}
export interface PreviewProperty {
  requestDraft?: import('../employee-properties/components/property-request-model').PropertyRequestDraft;
  code: string;
  title: string;
  region: string;
  price: string;
  area: number;
  rooms: string;
  status: PropertyStatus;
  owner: string;
  description: string;
  employees: readonly EmployeeFollowups[];
}
const followers = [
  {
    id: 'ahmad',
    name: 'أحمد محمد',
    entries: [
      {
        date: '2026-09-07',
        note: 'تم التواصل مع المالك وتأكيد السعر وإمكانية المعاينة.',
      },
      {
        date: '2026-09-05',
        note: 'طلب صورًا محدثة للعقار ومراجعة بيانات المساحة.',
      },
    ],
  },
  {
    id: 'sara',
    name: 'سارة أحمد',
    entries: [
      {
        date: '2026-09-08',
        note: 'متابعة مع المالك لتنسيق موعد زيارة العميل.',
      },
    ],
  },
] as const satisfies readonly EmployeeFollowups[];
export const programProperties = [
  {
    code: 'K0331',
    title: 'غرناطة - قطعة 2',
    region: 'غرناطة',
    price: '2,000 د.ك',
    area: 420,
    rooms: 'دور ونصف',
    status: 'إيجار',
    owner: 'أبو عبدالله',
    description:
      'عقار على شارع هادئ، مدخل مستقل ومساحات واسعة. بيانات توضيحية للمعاينة فقط.',
    employees: followers,
  },
  {
    code: 'K0334',
    title: 'غرناطة - قطعة 4',
    region: 'غرناطة',
    price: '320,000 د.ك',
    area: 375,
    rooms: '4 غرف',
    status: 'بيع',
    owner: 'أبو خالد',
    description: 'بيت على شارعين مع مواقف خاصة. بيانات تجريبية.',
    employees: [followers[1]],
  },
  {
    code: 'K0335',
    title: 'غرناطة - شارع رئيسي',
    region: 'غرناطة',
    price: '1,800 د.ك',
    area: 500,
    rooms: '4 غرف',
    status: 'تم التأجير',
    owner: 'أبو فهد',
    description: 'عقار مؤجر، يظهر في البرنامج للاطلاع على حالته وسجل المتابعة.',
    employees: followers,
  },
  {
    code: 'K029',
    title: 'مدينة المطلاع - N12',
    region: 'مدينة المطلاع',
    price: '290,000 د.ك',
    area: 400,
    rooms: '3 أدوار',
    status: 'بيع',
    owner: 'أبو فهد',
    description:
      'بيت في مدينة المطلاع، موقع مميز ومساحات عائلية. بيانات تجريبية.',
    employees: followers,
  },
  {
    code: 'K030',
    title: 'مدينة المطلاع - N8',
    region: 'مدينة المطلاع',
    price: '350,000 د.ك',
    area: 400,
    rooms: 'دور واحد',
    status: 'تم البيع',
    owner: 'أبو محمد',
    description: 'عقار تم بيعه، مع الاحتفاظ بالسجل للاطلاع فقط.',
    employees: [followers[0]],
  },
] as const satisfies readonly PreviewProperty[];
export interface ApprovalProperty extends PreviewProperty {
  submittedBy: string;
  submissionNote: string;
}
export const approvalProperties: readonly ApprovalProperty[] = [
  {
    ...programProperties[3],
    code: 'R201',
    title: 'بيت في المطلاع - قطعة 8',
    status: 'بانتظار الموافقة',
    submittedBy: 'أحمد محمد',
    submissionNote: 'مراجعة بيانات المالك والمساحة قبل الاعتماد.',
  },
  {
    ...programProperties[0],
    code: 'R202',
    title: 'غرناطة - قطعة 3',
    status: 'بانتظار الموافقة',
    submittedBy: 'سارة أحمد',
    submissionNote: 'مراجعة السعر والصور قبل الاعتماد.',
  },
];
