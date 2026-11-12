import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { useAuth } from '../../auth/components/auth-provider';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { confirmCommissionPayout } from '../../../lib/api/finance-api';
import { CommissionBreakdown } from './commission-breakdown';
import {
  COMMISSION_STATUS_LABEL,
  money,
  type Deal,
  type DealCommission,
} from '../deal-model';
import styles from './deals.module.css';

const exactMoney = (amount: string) => `${amount} د.ك`;

export function DealDetailsDrawer({
  deal,
  onClose,
  onRefresh,
  onBack,
}: {
  deal: Deal;
  onClose: () => void;
  /** Reloads the affected deal after a payout (OWNER only). */
  onRefresh?: () => Promise<Deal>;
  /** Optional return action, used when opened from a linked property card. */
  onBack?: () => void;
}) {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [current, setCurrent] = useState(deal);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  useEffect(() => setCurrent(deal), [deal]);

  const pay = async (commission: DealCommission) => {
    if (payingId) return;
    setPayingId(commission.id);
    setPayError(null);
    try {
      const paidAt = new Date().toISOString().slice(0, 10);
      await confirmCommissionPayout(commission.id, paidAt);
      let fresh: Deal | null = null;
      if (onRefresh) {
        // The payout already succeeded; a failed refresh must never look like
        // a failed payment, so fall back to the local paid state.
        try {
          fresh = await onRefresh();
        } catch {
          fresh = null;
        }
      }
      if (fresh) {
        setCurrent(fresh);
      } else {
        setCurrent((previous) => ({
          ...previous,
          commissions: previous.commissions.map((row) =>
            row.id === commission.id
              ? { ...row, status: 'PAID', paidAt }
              : row,
          ),
        }));
      }
      setConfirmingId(null);
    } catch (cause) {
      setPayError({
        id: commission.id,
        message:
          cause instanceof Error
            ? cause.message
            : 'تعذر تنفيذ الدفع. حاول مرة أخرى.',
      });
    } finally {
      setPayingId(null);
    }
  };

  const employeeCommissionControls = (
    role: DealCommission['role'],
  ) => {
    const commission = current.commissions.find((row) => row.role === role);
    if (!commission) return null;
    const name =
      role === 'PROPERTY_EMPLOYEE'
        ? current.propertyEmployee
        : current.clientEmployee;
    const label = role === 'PROPERTY_EMPLOYEE' ? 'موظف العقار' : 'موظف العميل';
    const amount = exactMoney(commission.amount);
    const pending = commission.status === 'PENDING';
    const confirming = confirmingId === commission.id;
    return (
      <>
        <div className={styles.row}>
          <span
            className={`${styles.badge} ${
              commission.status === 'PAID'
                ? styles.statusPaid
                : commission.status === 'PENDING'
                  ? styles.statusPending
                  : ''
            }`}
          >
            {COMMISSION_STATUS_LABEL[commission.status]}
            {commission.status === 'PAID' && commission.paidAt
              ? ` · ${commission.paidAt}`
              : ''}
          </span>
          {isOwner && pending && !confirming && (
            <Button
              type="button"
              className={styles.payoutPill}
              disabled={payingId !== null}
              onClick={() => {
                setPayError(null);
                setConfirmingId(commission.id);
              }}
            >
              دفع العمولة
            </Button>
          )}
        </div>
        {isOwner && confirming && (
          <div className={styles.notice}>
            <p>
              تأكيد صرف عمولة {label} ({name}) عن العقار {current.propertyId}{' '}
              بقيمة <strong>{amount}</strong>؟
            </p>
            <div className={styles.row}>
              <Button
                type="button"
                className={styles.payoutPill}
                disabled={payingId !== null}
                onClick={() => void pay(commission)}
              >
                {payingId === commission.id ? 'جارٍ الدفع...' : 'تأكيد الدفع'}
              </Button>
              <Button
                type="button"
                className={styles.payoutPill}
                disabled={payingId !== null}
                onClick={() => setConfirmingId(null)}
              >
                إلغاء
              </Button>
            </div>
          </div>
        )}
        {payError && payError.id === commission.id && (
          <p role="alert">{payError.message}</p>
        )}
      </>
    );
  };

  return (
    <PropertyOverlay
      title={`تفاصيل الصفقة · ${current.propertyId}`}
      drawer
      onClose={onClose}
      onBack={onBack}
    >
      <dl className={styles.facts}>
        {[
          ['العقار', `${current.property.title} · ${current.propertyId}`],
          ['المالك', current.property.owner],
          ['المنطقة', current.property.area],
          ['العميل', current.client.name],
          ['تم التسجيل بواسطة', current.createdBy],
          ['نوع الصفقة', current.type],
          ['قيمة الصفقة', money(current.price)],
          ['تاريخ الإغلاق', current.date],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>توزيع العمولات</h3>
      <CommissionBreakdown
        deal={current}
        stacked
        renderEmployeeAction={employeeCommissionControls}
      />
      <p>{current.notes || 'لا توجد ملاحظات.'}</p>
      <p className={styles.notice}>
        تم تسجيل الصفقة وتحديث حالة العقار إلى «{current.property.statusLabel}».
      </p>
    </PropertyOverlay>
  );
}
