'use client';
import { useState } from 'react';
import { PropertyOverlay } from './property-overlay';
import { Button } from '../../../components/ui/button';
import styles from './properties.module.css';

/**
 * Soft-delete confirmation. The operation is recoverable from the Manager Trash,
 * so it asks for an optional reason rather than the property code.
 */
export function TrashDeleteDialog({
  propertyCode,
  busy = false,
  error = '',
  onConfirm,
  onClose,
}: {
  propertyCode: string;
  busy?: boolean;
  error?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <PropertyOverlay
      title={`حذف العقار ${propertyCode} إلى سلة المحذوفات`}
      onClose={onClose}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          onConfirm(reason.trim());
        }}
      >
        <p className={styles.trashDialogText}>
          سيُنقل العقار إلى سلة المحذوفات ويمكن استعادته لاحقاً بنفس الرقم
          والبيانات. لن تُحذف بيانات المالك أو العملاء المرتبطين.
        </p>
        <label className={styles.field}>
          سبب الحذف (اختياري)
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثال: تسجيل مكرر، أو طلب من المالك."
            disabled={busy}
          />
        </label>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.formActions}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? 'جارٍ الحذف…' : 'تأكيد الحذف'}
          </Button>
        </div>
      </form>
    </PropertyOverlay>
  );
}

/**
 * Permanent deep-delete confirmation. Irreversible through normal CRM tools;
 * requires typing the exact property code.
 */
export function PermanentDeleteDialog({
  propertyCode,
  busy = false,
  error = '',
  onConfirm,
  onClose,
}: {
  propertyCode: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === propertyCode;
  return (
    <PropertyOverlay
      title={`حذف نهائي للعقار ${propertyCode}`}
      onClose={onClose}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!matches || busy) return;
          onConfirm();
        }}
      >
        <p className={styles.trashDialogDanger} role="alert">
          هذا الإجراء لا يمكن التراجع عنه عبر أدوات النظام العادية. سيُحذف
          العقار وبياناته الخاصة (الأدوار، الصور، طلبات المراجعة) نهائياً.
        </p>
        <p className={styles.trashDialogText}>
          لن يُحذف سجل المالك/جهة التواصل أو العملاء أو تاريخ المتابعة. تبقى
          نسخة احتياطية من قاعدة البيانات حتى انتهاء مدة الاحتفاظ المُعدّة.
        </p>
        <label className={styles.field}>
          اكتب رقم العقار <bdi>{propertyCode}</bdi> للتأكيد
          <input
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={propertyCode}
            autoComplete="off"
            disabled={busy}
            aria-label={`اكتب رقم العقار ${propertyCode} للتأكيد`}
          />
        </label>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.formActions}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={!matches || busy}
            aria-busy={busy}
          >
            {busy ? 'جارٍ الحذف النهائي…' : 'حذف نهائي'}
          </Button>
        </div>
      </form>
    </PropertyOverlay>
  );
}
