export type Category =
  'followups' | 'properties' | 'manager' | 'reviews' | 'attendance';
export interface EmployeeNotification {
  id: string;
  title: string;
  description: string;
  category: Category;
  date: string;
  read: boolean;
  priority: 'عادي' | 'مهم' | 'عاجل';
  source: string;
  person?: string;
  property?: string;
  detail: string;
  action: string;
  late?: boolean;
}
export const labels: Record<Category, string> = {
  followups: 'متابعات',
  properties: 'عقارات',
  manager: 'رسائل المدير',
  reviews: 'مراجعات العقارات',
  attendance: 'الحضور',
};
export const tabs = [
  { id: 'all', label: 'الكل' },
  { id: 'unread', label: 'غير مقروء' },
  { id: 'followups', label: 'متابعات' },
  { id: 'properties', label: 'عقارات' },
  { id: 'manager', label: 'رسائل المدير' },
  { id: 'reviews', label: 'مراجعات العقارات' },
];
export function filterNotifications(
  items: EmployeeNotification[],
  tab: string,
) {
  return items.filter(
    (item) =>
      tab === 'all' ||
      (tab === 'unread' && !item.read) ||
      item.category === tab,
  );
}
export function markRead(items: EmployeeNotification[], id?: string) {
  return items.map((item) =>
    !id || item.id === id ? { ...item, read: true } : item,
  );
}
export const samples: EmployeeNotification[] = [
  {
    id: 'n1',
    title: 'متابعة عميل متأخرة',
    description: 'طلب محمد العتيبي يحتاج إلى تحديث.',
    category: 'followups',
    date: '2026-09-09T10:00:00+03:00',
    read: false,
    priority: 'عاجل',
    source: 'متابعة عميل F101',
    person: 'محمد العتيبي',
    detail: 'آخر متابعة في 7 سبتمبر. كان الموعد التالي في 8 سبتمبر.',
    action: 'تواصل مع العميل وسجل نتيجة المتابعة.',
    late: true,
  },
  {
    id: 'n2',
    title: 'متابعة مالك متأخرة',
    description: 'تذكير بالتواصل مع المالك أبو فهد.',
    category: 'followups',
    date: '2026-09-09T09:50:00+03:00',
    read: false,
    priority: 'مهم',
    source: 'متابعة مالك F102',
    person: 'أبو فهد',
    property: 'بيت المطلاع K027',
    detail: 'مطلوب تأكيد السعر وإتاحة العقار للمعاينة.',
    action: 'راجع متابعة المالك وحدد موعد التواصل.',
    late: true,
  },
  {
    id: 'n3',
    title: 'عقار مناسب لطلب عميل',
    description: 'دور غرناطة يناسب طلب سارة سالم.',
    category: 'properties',
    date: '2026-09-09T09:40:00+03:00',
    read: false,
    priority: 'مهم',
    source: 'مطابقة تجريبية M001',
    person: 'سارة سالم',
    property: 'دور غرناطة K0331',
    detail: 'إيجار بقيمة 2,000 د.ك شهريًا، ضمن ميزانية العميل.',
    action: 'راجع العقار مع العميل قبل ترتيب المعاينة.',
  },
  {
    id: 'n4',
    title: 'رسالة من المدير',
    description: 'يرجى تحديث نتائج المتابعات اليومية.',
    category: 'manager',
    date: '2026-09-09T09:30:00+03:00',
    read: false,
    priority: 'مهم',
    source: 'رسالة المدير MSG001',
    detail: 'تأكد من تسجيل آخر نتيجة للتواصل ومواعيد المتابعات القادمة.',
    action: 'راجع المتابعات المستحقة وحدّث نتائجها.',
  },
  {
    id: 'n5',
    title: 'تم اعتماد العقار الذي أرسلته',
    description: 'تم اعتماد بيت المطلاع وإتاحته ضمن العقارات.',
    category: 'reviews',
    date: '2026-09-09T09:20:00+03:00',
    read: false,
    priority: 'عادي',
    source: 'مراجعة عقار R001',
    property: 'بيت المطلاع K027',
    person: 'أبو فهد',
    detail: 'حالة المراجعة التجريبية: معتمد.',
    action: 'راجع بيانات العقار المعتمد.',
  },
  {
    id: 'n6',
    title: 'العقار الذي أرسلته يحتاج تعديل',
    description: 'يرجى تحديث بيانات المساحة والعنوان.',
    category: 'reviews',
    date: '2026-09-09T09:10:00+03:00',
    read: false,
    priority: 'مهم',
    source: 'مراجعة عقار R002',
    property: 'دور غرناطة K0333',
    detail: 'ملاحظات المدير: تأكد من المساحة وأضف رقم القطعة والشارع.',
    action: 'عدّل البيانات ثم أعد إرسال العقار للمراجعة.',
  },
  {
    id: 'n7',
    title: 'تذكير بمتابعة قادمة',
    description: 'موعد متابعة محمد العتيبي اليوم الساعة 15:30.',
    category: 'followups',
    date: '2026-09-09T09:00:00+03:00',
    read: true,
    priority: 'عادي',
    source: 'تذكير F103',
    person: 'محمد العتيبي',
    detail: 'مراجعة العرض وتأكيد رغبة العميل في المعاينة.',
    action: 'استعد للتواصل في الموعد المحدد.',
  },
  {
    id: 'n8',
    title: 'تنبيه حضور أو تأخير',
    description: 'تم تسجيل حضورك الساعة 09:30.',
    category: 'attendance',
    date: '2026-09-08T09:30:00+03:00',
    read: true,
    priority: 'عادي',
    source: 'حضور A001',
    detail: 'سجل حضور تجريبي متأخر. لم يتم حساب أي خصم.',
    action: 'راجع سجل الحضور مع المدير عند الحاجة.',
  },
];
