import type { ReactNode } from 'react';
import { money, type CommissionView } from '../deal-model';
import styles from './deals.module.css';

export type DealEmployeeCommissionRole =
  | 'PROPERTY_EMPLOYEE'
  | 'CLIENT_EMPLOYEE';

/**
 * The ORIGINAL «توزيع العمولات» cards: company + both employee commissions.
 * The optional renderer lets the details drawer place its payout controls
 * inside the existing employee cards without adding another section.
 */
export function CommissionBreakdown({
  deal,
  renderEmployeeAction,
  stacked = false,
}: {
  deal: CommissionView;
  renderEmployeeAction?: (role: DealEmployeeCommissionRole) => ReactNode;
  /** Deal-details layout: one full-width card per row, stacked vertically. */
  stacked?: boolean;
}) {
  return (
    <dl
      className={`${styles.facts} ${stacked ? styles.commissionFacts : ''}`}
    >
      <div>
        <dt>عمولة الشركة</dt>
        <dd>{money(deal.companyCommission)}</dd>
      </div>
      <div>
        <dt>موظف العقار: {deal.propertyEmployee}</dt>
        <dd>{money(deal.propertyCommission)}</dd>
        {renderEmployeeAction?.('PROPERTY_EMPLOYEE')}
      </div>
      <div>
        <dt>موظف العميل: {deal.clientEmployee}</dt>
        <dd>{money(deal.clientCommission)}</dd>
        {renderEmployeeAction?.('CLIENT_EMPLOYEE')}
      </div>
    </dl>
  );
}
