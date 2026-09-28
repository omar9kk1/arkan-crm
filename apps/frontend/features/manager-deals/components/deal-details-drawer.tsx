import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { CommissionBreakdown } from './commission-breakdown';
import { money, type MockDeal } from '../mock-data';
import styles from './deals.module.css';
export function DealDetailsDrawer({
  deal,
  onClose,
}: {
  deal: MockDeal;
  onClose: () => void;
}) {
  return (
    <PropertyOverlay
      title={`تفاصيل الصفقة · ${deal.propertyId}`}
      drawer
      onClose={onClose}
    >
      <dl className={styles.facts}>
        {[
          ['العقار', `${deal.property.title} · ${deal.propertyId}`],
          ['المالك', deal.property.owner],
          ['المساحة', `${deal.property.area} م²`],
          ['العميل', `${deal.client.name} · ${deal.clientId}`],
          ['سجل الصفقة', deal.createdBy],
          ['نوع الصفقة', deal.type],
          ['سعر العقار', money(deal.price)],
          ['تاريخ الإغلاق', deal.date],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>توزيع العمولات</h3>
      <CommissionBreakdown deal={deal} />
      <h3>الحركات المالية المرتبطة — معاينة</h3>
      <ul className={styles.list}>
        <li>عمولة داخلة للشركة: {money(deal.companyCommission)}</li>
        <li>
          عمولة خارجة لموظف العقار ({deal.propertyEmployee}):{' '}
          {money(deal.propertyCommission)}
        </li>
        <li>
          عمولة خارجة لموظف العميل ({deal.clientEmployee}):{' '}
          {money(deal.clientCommission)}
        </li>
      </ul>
      <p>{deal.notes || 'لا توجد ملاحظات.'}</p>
      <p className={styles.notice}>
        العقار لا يُحذف؛ تتغير حالته فقط إلى «{deal.property.status}». الحركات
        المعروضة تجريبية وغير محفوظة.
      </p>
    </PropertyOverlay>
  );
}
