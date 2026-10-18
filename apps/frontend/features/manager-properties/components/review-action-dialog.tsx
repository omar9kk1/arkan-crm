'use client';
import { useState } from 'react';
import { PropertyOverlay } from './property-overlay';
import { Button } from '../../../components/ui/button';
import styles from './properties.module.css';

/**
 * Mandatory-reason dialog behind the manager's «طلب تعديل» and «رفض» buttons.
 *
 * The two actions now map to two distinct endpoints: `action: 'changes'` calls
 * `POST /properties/:id/request-changes` (the property stays PENDING and the
 * review becomes CHANGES_REQUESTED) while `action: 'reject'` calls
 * `POST /properties/:id/reject` (the property becomes REJECTED). Neither action
 * is optimistic — the caller sends the request and this dialog stays open with
 * the typed reason preserved until the server confirms.
 */
export function ReviewActionDialog({
  propertyCode,
  action,
  busy = false,
  error = '',
  onConfirm,
  onClose,
}: {
  propertyCode: string;
  action: 'reject' | 'changes';
  busy?: boolean;
  error?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState('');
  const label = action === 'reject' ? 'رفض' : 'طلب تعديل';
  return (
    <PropertyOverlay title={`${label} العقار ${propertyCode}`} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason.trim()) {
            setLocalError('سبب القرار إلزامي، ويظهر للموظف مع القرار.');
            return;
          }
          setLocalError('');
          onConfirm(reason.trim());
        }}
      >
        <label className={styles.field}>
          سبب القرار
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="اكتب سببًا واضحًا يساعد الموظف على التعديل قبل إعادة الإرسال."
            autoFocus
          />
        </label>
        {(localError || error) && (
          <p className={styles.formError} role="alert">
            {localError || error}
          </p>
        )}
        <div className={styles.formActions}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? 'جارٍ الإرسال…' : `تأكيد ${label}`}
          </Button>
        </div>
      </form>
    </PropertyOverlay>
  );
}
