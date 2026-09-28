import { money, type DealDraft } from '../mock-data';
import styles from './deals.module.css';
export function CommissionBreakdown({
  deal,
}: {
  deal: Pick<
    DealDraft,
    | 'companyCommission'
    | 'propertyCommission'
    | 'clientCommission'
    | 'propertyEmployee'
    | 'clientEmployee'
  >;
}) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>عمولة الشركة</dt>
        <dd>{money(deal.companyCommission)}</dd>
      </div>
      <div>
        <dt>موظف العقار: {deal.propertyEmployee}</dt>
        <dd>{money(deal.propertyCommission)}</dd>
      </div>
      <div>
        <dt>موظف العميل: {deal.clientEmployee}</dt>
        <dd>{money(deal.clientCommission)}</dd>
      </div>
    </dl>
  );
}
