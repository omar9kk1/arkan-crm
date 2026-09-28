export type DealType = 'بيع' | 'تأجير';
export interface MockProperty {
  id: string;
  title: string;
  area: number;
  owner: string;
  employee: string;
  status: 'متاح' | 'تم البيع' | 'تم التأجير';
}
export interface MockClient {
  id: string;
  name: string;
  employee: string;
}
export interface DealDraft {
  propertyId: string;
  clientId: string;
  propertyEmployee: string;
  clientEmployee: string;
  type: DealType;
  price: number;
  companyCommission: number;
  propertyCommission: number;
  clientCommission: number;
  date: string;
  notes: string;
}
export interface MockDeal extends DealDraft {
  id: string;
  property: MockProperty;
  client: MockClient;
  createdBy: string;
}
export const employees = ['أحمد محمد', 'سارة أحمد', 'خالد مبارك'];
export const mockProperties: MockProperty[] = [
  {
    id: 'K027',
    title: 'بيت المطلاع',
    area: 400,
    owner: 'أبو فهد',
    employee: 'خالد مبارك',
    status: 'تم البيع',
  },
  {
    id: 'K0331',
    title: 'عقار غرناطة',
    area: 420,
    owner: 'أبو عبدالله',
    employee: 'سارة أحمد',
    status: 'تم التأجير',
  },
  {
    id: 'K029',
    title: 'المطلاع - N12',
    area: 400,
    owner: 'أبو محمد',
    employee: 'أحمد محمد',
    status: 'متاح',
  },
  {
    id: 'K0334',
    title: 'غرناطة - قطعة 4',
    area: 375,
    owner: 'أبو خالد',
    employee: 'خالد مبارك',
    status: 'متاح',
  },
];
export const mockClients: MockClient[] = [
  { id: 'C01', name: 'محمد العتيبي', employee: 'أحمد محمد' },
  { id: 'C02', name: 'شركة الواحة', employee: 'سارة أحمد' },
  { id: 'C03', name: 'عبدالله سالم', employee: 'سارة أحمد' },
];
export const initialDeals: MockDeal[] = mockProperties
  .slice(0, 2)
  .map((property, index) => ({
    id: `D00${index + 1}`,
    propertyId: property.id,
    clientId: mockClients[index]!.id,
    property,
    client: mockClients[index]!,
    propertyEmployee: property.employee,
    clientEmployee: mockClients[index]!.employee,
    type: index === 0 ? 'بيع' : 'تأجير',
    price: index === 0 ? 300000 : 2000,
    companyCommission: index === 0 ? 3000 : 500,
    propertyCommission: index === 0 ? 1000 : 250,
    clientCommission: index === 0 ? 2000 : 250,
    date: `2026-09-0${7 - index}`,
    notes: 'بيانات تجريبية للمعاينة فقط.',
    createdBy: 'مدير النظام',
  }));
export const money = (value: number) =>
  `${new Intl.NumberFormat('ar-KW', { maximumFractionDigits: 3 }).format(value)} د.ك`;
