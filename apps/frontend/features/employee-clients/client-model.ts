export interface FollowUp {
  id: string;
  date: string;
  type: string;
  result: string;
  note: string;
  next: string;
  /** Display name of the employee the follow-up is assigned to. */
  employee: string;
}
export interface SuitableProperty {
  name: string;
  area: string;
  price: string;
}
/**
 * One recorded interest of this client in an EXISTING program property
 * (`ClientPropertyInterest`). `propertyId` is the immutable `Property.id` so
 * the drawer can deep-link the EXACT property (never by code).
 */
export interface ClientInterest {
  propertyId: string;
  /** Clean property title — the display CODE travels in `code` separately. */
  name: string;
  /** Display reference (optional: temporary mirror rows reuse title only). */
  code?: string;
  area: string;
  price: string;
  reason: string;
  notes: string;
}
export interface EmployeeClient {
  requestBundle?: import('./components/request-wizard/client-request-bundle').ClientRequestBundle;
  requestDraft?: import('./components/request-wizard/client-request-model').ClientRequestDraft;
  id: string;
  name: string;
  phone: string;
  type: string;
  /** Display name of the responsible employee from `Client.responsibleEmployeeId`. */
  employee: string;
  area: string;
  budget: string;
  notes: string;
  next: string;
  history: FollowUp[];
  properties: SuitableProperty[];
  propertyInterests: ClientInterest[];
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
export function isLate(c: EmployeeClient, today: string): boolean {
  return Boolean(c.next && c.next < today);
}
export function filterClients(clients: EmployeeClient[], tab: string, today: string) {
  switch (tab) {
    case 'today':
      return clients.filter((c) => c.next === today);
    case 'late':
      return clients.filter((c) => isLate(c, today));
    case 'unmatched':
      return clients.filter((c) => !c.properties.length);
    default:
      return clients;
  }
}
import type { ClientApiDto } from '../../lib/api/client-types';

const currencyLabel = (code: string | null): string => {
  if (!code) return 'د.ك';
  if (code === 'KWD') return 'د.ك';
  if (code.toLowerCase() === 'usd') return 'دولار أمريكي';
  return code;
};

function formatPrice(price: string | null, currency: string | null): string {
  if (!price) return '';
  const num = Number(price);
  if (Number.isNaN(num)) return price;
  const cur = currencyLabel(currency);
  if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)} مليون ${cur}`;
  return `${Math.round(num).toLocaleString('ar-KW')} ${cur}`;
}

export function employeeClientFromDto(dto: ClientApiDto): EmployeeClient {
  const logged = dto.followUps.filter((f) => f.outcome || f.note);
  return {
    id: dto.id,
    name: dto.name,
    phone: dto.phone,
    type: '—',
    employee: dto.responsibleEmployeeName || 'غير مُسند',
    area: '—',
    budget: '—',
    notes: dto.notes,
    next: dto.nextFollowUp || '',
    history: logged.map((f) => ({
      id: f.id,
      date: f.createdAt.slice(0, 10),
      type: f.method || 'متابعة',
      result: f.outcome,
      note: f.note,
      next: f.dueAt,
      employee: f.employeeName || 'غير مُسند',
    })),
    properties: dto.properties.map((p) => ({
      name: `${p.title}${p.reference ? ` ${p.reference}` : ''}`.trim() || p.title,
      area: p.area || '',
      price: p.askingPrice ? `${formatPrice(p.askingPrice, p.currency)}` : '—',
    })),
    propertyInterests: dto.propertyInterests.map((interest) => ({
      propertyId: interest.propertyId,
      // Title and code on SEPARATE lines below it, per the interest card
      // layout — never merged into one cramped line.
      name: interest.title,
      code: interest.reference,
      area: interest.area || '',
      price: interest.askingPrice
        ? `${formatPrice(interest.askingPrice, interest.currency)}`
        : '—',
      reason: interest.reason,
      notes: interest.notes,
    })),
  };
}
