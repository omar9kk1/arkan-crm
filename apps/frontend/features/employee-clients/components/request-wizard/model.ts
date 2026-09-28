export interface RequestDraft {
  name: string;
  phone: string;
  type: string;
  area: string;
  budget: string;
  notes: string;
  message: string;
  mode: 'new' | 'existing';
  property: string;
}
export const initialDraft: RequestDraft = {
  name: '',
  phone: '',
  type: 'شراء',
  area: '',
  budget: '',
  notes: '',
  message: '',
  mode: 'new',
  property: '',
};
export const sampleProperties = [
  { name: 'بيت المطلاع K027', area: 'مدينة المطلاع', price: '290,000 د.ك' },
  { name: 'دور غرناطة K0331', area: 'غرناطة', price: '2,000 د.ك / شهر' },
];
export function draftError(d: RequestDraft) {
  return !d.name.trim() || !d.phone.trim() || !d.area.trim()
    ? 'أدخل الاسم والهاتف والمنطقة.'
    : !Number.isFinite(Number(d.budget)) || Number(d.budget) <= 0
      ? 'أدخل ميزانية أكبر من صفر.'
      : d.mode === 'existing' &&
          !sampleProperties.some((p) => p.name === d.property)
        ? 'اختر العقار المرتبط بالطلب.'
        : '';
}
