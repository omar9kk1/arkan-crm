export interface Property {
  requestDraft?: import('./components/property-request-model').PropertyRequestDraft;
  id: string;
  code: string;
  title: string;
  owner: string;
  phone: string;
  ownerNotes: string;
  operation: string;
  region: string;
  address: string;
  area: string;
  rooms: string;
  price: string;
  description: string;
  status: string;
  mine: boolean;
  assignment: string;
  managerNotes: string;
  followers: { name: string; entries: { date: string; note: string }[] }[];
}
export const empty: Property = {
  id: '',
  code: '',
  title: '',
  owner: '',
  phone: '',
  ownerNotes: '',
  operation: 'بيع',
  region: '',
  address: '',
  area: '',
  rooms: '',
  price: '',
  description: '',
  status: 'بانتظار الموافقة',
  mine: true,
  assignment: '',
  managerNotes: '',
  followers: [{ name: 'أحمد محمد', entries: [] }],
};
export const owners = [
  { name: 'أبو فهد', phone: '6666 1122' },
  { name: 'أم عبدالله', phone: '6666 2233' },
];
export const tabs = [
  { id: 'all', label: 'كل العقارات' },
  { id: 'mine', label: 'عقاراتي' },
  { id: 'assigned', label: 'مخصصة لي' },
  { id: 'review', label: 'تحت المراجعة' },
  { id: 'changes', label: 'مطلوب تعديل' },
];
export const samples: Property[] = Array.from({ length: 6 }, (_, i) => ({
  ...empty,
  id: `p${i}`,
  code: `K033${i + 1}`,
  title: i % 2 ? 'بيت المطلاع' : 'دور غرناطة',
  owner: 'أبو فهد',
  phone: '6666 1122',
  region: i % 2 ? 'مدينة المطلاع' : 'غرناطة',
  address: 'قطعة 2، شارع 10',
  area: '400',
  rooms: '5 غرف',
  price: i % 2 ? '290000' : '2000',
  operation: i % 2 ? 'بيع' : 'إيجار',
  description: 'عقار جاهز للمعاينة — بيانات تجريبية.',
  status: [
    'معتمد',
    'بانتظار الموافقة',
    'مطلوب تعديل',
    'تم البيع',
    'تم التأجير',
    'معتمد',
  ][i]!,
  mine: i < 3,
  assignment:
    i === 0
      ? 'تسويق فقط'
      : i === 4
        ? 'متابعة مالك'
        : i === 5
          ? 'تجهيز معاينات'
          : '',
  managerNotes:
    i === 2 ? 'يرجى توضيح المساحة وتحديث العنوان قبل إعادة الإرسال.' : '',
  followers: [
    {
      name: 'أحمد محمد',
      entries: [{ date: '2026-09-07', note: 'تأكيد إتاحة العقار للمعاينة.' }],
    },
    {
      name: 'سارة أحمد',
      entries: [{ date: '2026-09-08', note: 'مراجعة السعر مع المالك.' }],
    },
  ],
}));
export function filterProperties(
  items: Property[],
  tab: string,
  query: string,
) {
  const q = query.trim().toLocaleLowerCase('ar');
  return items.filter(
    (p) =>
      (tab === 'all' ||
        (tab === 'mine' && p.mine) ||
        (tab === 'assigned' && !!p.assignment) ||
        (tab === 'review' && p.status === 'بانتظار الموافقة') ||
        (tab === 'changes' && p.status === 'مطلوب تعديل')) &&
      `${p.title} ${p.region} ${p.code}`.toLocaleLowerCase('ar').includes(q),
  );
}
export function validate(p: Property, step: number) {
  if (!p.owner.trim() || !p.phone.trim()) return 'أدخل اسم المالك والهاتف.';
  if (
    step > 0 &&
    (!p.title.trim() ||
      !p.region.trim() ||
      !p.address.trim() ||
      !p.rooms.trim() ||
      !Number.isFinite(Number(p.area)) ||
      Number(p.area) <= 0 ||
      !Number.isFinite(Number(p.price)) ||
      Number(p.price) <= 0)
  )
    return 'راجع بيانات العقار والمساحة والسعر.';
  return '';
}
