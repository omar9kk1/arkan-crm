'use client';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import {
  normalizePhone,
  type ContactType,
} from '../../../lib/contact-registry';
import styles from './clients.module.css';

/** Adds a company-level owner/broker record from the Clients & Follow-ups pages. */
export function ContactFormModal({
  type,
  onClose,
  onSave,
}: {
  type: ContactType;
  onClose: () => void;
  onSave: (input: { name: string; phone: string; notes: string }) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const label = type === 'BROKER' ? 'الوسيط' : 'المالك';
  return (
    <PropertyOverlay title={`إضافة ${label} إلى السجل`} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setError(`أدخل اسم ${label}.`);
            return;
          }
          if (!normalizePhone(phone)) {
            setError('أدخل رقم هاتف صحيحًا.');
            return;
          }
          onSave({
            name: name.trim(),
            phone: phone.trim(),
            notes: notes.trim(),
          });
        }}
      >
        <label className={styles.field}>
          اسم {label}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          رقم الهاتف
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            dir="ltr"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          ملاحظات (اختياري)
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        {error && <p className={styles.formError}>{error}</p>}
        <div className={styles.formActions}>
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit">حفظ</Button>
        </div>
      </form>
    </PropertyOverlay>
  );
}
