export const categories = {
  property: 'عقارات',
  followup: 'متابعات',
  deal: 'صفقات وعمولات',
  attendance: 'حضور وانصراف',
  finance: 'مالية',
};
export type NotificationFilter = 'all' | 'unread' | keyof typeof categories;
export interface ManagerNotification {
  id: string;
  title: string;
  description: string;
  category: keyof typeof categories;
  date: string;
  read: boolean;
  priority: 'عادي' | 'مهم' | 'عاجل';
  source: string;
  employee?: string;
  property?: string;
  person?: string;
  detail: string;
  action: string;
  needsReview?: boolean;
}
export function filterNotifications(
  items: readonly ManagerNotification[],
  filter: NotificationFilter,
) {
  return items.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'unread' ? !item.read : item.category === filter),
  );
}
export function markRead(items: readonly ManagerNotification[], id?: string) {
  return items.map((item) =>
    !id || item.id === id ? { ...item, read: true } : item,
  );
}
export const displayDate = (date: string) =>
  new Intl.DateTimeFormat('ar-KW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
export const mockNotifications: ManagerNotification[] = [
  {
    id: 'n1',
    title: 'عقار جديد بانتظار موافقة المدير',
    description: 'بيت في المطلاع، أرسله أحمد محمد للمراجعة.',
    category: 'property',
    date: '2026-09-09T10:40:00+03:00',
    read: false,
    priority: 'مهم',
    source: 'طلب اعتماد R201',
    employee: 'أحمد محمد',
    property: 'بيت المطلاع K029',
    person: 'المالك أبو فهد',
    detail: 'حالة الموافقة: بانتظار الموافقة. السعر المقترح 290,000 د.ك.',
    action: 'مراجعة بيانات العقار والمالك قبل الاعتماد.',
    needsReview: true,
  },
  {
    id: 'n2',
    title: 'متابعة مالك متأخرة',
    description: 'تأخر خالد مبارك في متابعة المالك أبو فهد.',
    category: 'followup',
    date: '2026-09-09T10:00:00+03:00',
    read: false,
    priority: 'عاجل',
    source: 'متابعة مالك F101',
    employee: 'خالد مبارك',
    property: 'بيت المطلاع K029',
    person: 'المالك أبو فهد',
    detail: 'آخر متابعة: 2026-09-06. المتابعة المستحقة: 2026-09-07.',
    action: 'التواصل مع الموظف لتحديث نتيجة متابعة المالك.',
    needsReview: true,
  },
  {
    id: 'n3',
    title: 'متابعة عميل متأخرة',
    description: 'سارة أحمد لديها متابعة مستحقة للعميل محمد العتيبي.',
    category: 'followup',
    date: '2026-09-09T09:45:00+03:00',
    read: false,
    priority: 'مهم',
    source: 'متابعة عميل F102',
    employee: 'سارة أحمد',
    person: 'العميل محمد العتيبي',
    detail:
      'آخر متابعة: 2026-09-05. موعد المتابعة القادمة المتأخر: 2026-09-08.',
    action: 'مراجعة طلب العميل وتحديد موعد متابعة جديد.',
    needsReview: true,
  },
  {
    id: 'n4',
    title: 'صفقة جديدة تم تسجيلها',
    description: 'تم تسجيل بيع بيت المطلاع للعميل محمد العتيبي.',
    category: 'deal',
    date: '2026-09-09T09:30:00+03:00',
    read: false,
    priority: 'عادي',
    source: 'صفقة D001',
    employee: 'أحمد محمد',
    property: 'بيت المطلاع K027',
    person: 'العميل محمد العتيبي',
    detail: 'قيمة الصفقة التجريبية 300,000 د.ك. حالة العقار: تم البيع.',
    action: 'الاطلاع على تفاصيل الصفقة وتوزيع العمولات.',
  },
  {
    id: 'n5',
    title: 'عمولة موظف تحتاج مراجعة',
    description: 'عمولة خالد مبارك مرتبطة بالصفقة D001.',
    category: 'deal',
    date: '2026-09-09T09:20:00+03:00',
    read: false,
    priority: 'مهم',
    source: 'عمولة C001',
    employee: 'خالد مبارك',
    property: 'بيت المطلاع K027',
    detail: 'قيمة العمولة التجريبية 1,000 د.ك. الحالة: تحتاج مراجعة.',
    action: 'مراجعة استحقاق الموظف وتوزيع العمولة.',
    needsReview: true,
  },
  {
    id: 'n6',
    title: 'موظف متأخر في الحضور',
    description: 'سجل خالد مبارك حضوره الساعة 09:30.',
    category: 'attendance',
    date: '2026-09-09T09:30:00+03:00',
    read: false,
    priority: 'عادي',
    source: 'سجل حضور A001',
    employee: 'خالد مبارك',
    detail: 'الحالة: متأخر. لا توجد خصومات راتب محسوبة في المعاينة.',
    action: 'مراجعة سبب التأخير مع الموظف.',
  },
  {
    id: 'n7',
    title: 'راتب تم تسجيله كمصروف',
    description: 'تم تسجيل راتب سارة أحمد ضمن الحركات المالية.',
    category: 'finance',
    date: '2026-09-08T15:00:00+03:00',
    read: true,
    priority: 'عادي',
    source: 'راتب P002 / حركة FM006',
    employee: 'سارة أحمد',
    detail: 'مصروف راتب تجريبي بقيمة 1,400 د.ك.',
    action: 'مراجعة تفاصيل الراتب في سجل الحركة المالية.',
  },
  {
    id: 'n8',
    title: 'مصروف يدوي تم تسجيله',
    description: 'مصروف تصوير عقار في غرناطة.',
    category: 'finance',
    date: '2026-09-08T12:00:00+03:00',
    read: true,
    priority: 'عادي',
    source: 'مصروف EXP001 / حركة FM007',
    property: 'غرناطة K0331',
    detail: 'مصروف تصوير تجريبي بقيمة 75 د.ك.',
    action: 'مراجعة وصف المصروف والعقار المرتبط.',
  },
].sort((a, b) => b.date.localeCompare(a.date)) as ManagerNotification[];
