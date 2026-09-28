import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import type { Followup } from '../model';
import { FollowupTimeline, FollowupStatusBadge } from './followup-card';
import styles from './followups.module.css';
export function FollowupDetailsDrawer({
  item,
  onClose,
  onResult,
}: {
  item: Followup;
  onClose: () => void;
  onResult: () => void;
}) {
  return (
    <PropertyOverlay title={item.name} drawer onClose={onClose}>
      <FollowupStatusBadge item={item} />
      <p>{item.kind} · الموظف: أحمد محمد</p>
      <p>
        الهاتف: <bdi>{item.phone}</bdi>
      </p>
      <p>العقار: {item.property || 'غير مرتبط بعقار'}</p>
      <p>سبب المتابعة: {item.reason}</p>
      <p>
        المتابعة القادمة:{' '}
        {item.complete ? 'لا توجد — مكتملة' : item.due.replace('T', ' ')}
      </p>
      <p>آخر نتيجة: {item.history[0]?.result || 'لم تسجل'}</p>
      <p>{item.note}</p>
      <h3>سجل المتابعات السابق</h3>
      <FollowupTimeline items={item.history} />
      <div className={styles.actions}>
        <Button onClick={onResult}>تسجيل نتيجة</Button>
        <Button onClick={onResult}>تحديد متابعة قادمة</Button>
        <Button onClick={onClose}>إغلاق</Button>
      </div>
    </PropertyOverlay>
  );
}
