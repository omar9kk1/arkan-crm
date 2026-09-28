import {
  useDraftScope,
  useDraftFields,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';
import { useState } from 'react';
import { GlassSelect } from '../../../components/ui/glass-select';
import { Button } from '../../../components/ui/button';
import { localDate, type FollowUp } from '../client-model';
import styles from './clients.module.css';
// Inline section inside the client dialog avoids nesting modal focus traps.
export function AddFollowUpModal({
  clientId,
  onSave,
  onCancel,
}: {
  clientId: string;
  onSave: (item: FollowUp) => void;
  onCancel: () => void;
}) {
  const formKey = 'client-followup:' + clientId;
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const draftField = useDraftFields(formKey);

  const [error, setError] = useState('');
  return (
    <section aria-label="إضافة متابعة" className={styles.inset}>
      <h3>إضافة متابعة</h3>
      <>
        <DraftTools formKey={formKey} />{' '}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const result = String(data.get('result') || '').trim();
            if (!result) {
              setError('أدخل نتيجة التواصل.');
              return;
            }
            onSave({
              id:
                globalThis.crypto?.randomUUID?.() ??
                `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              date: localDate(),
              type: String(data.get('type')),
              next: String(data.get('next')),
              result,
              note: String(data.get('note') || '').trim(),
            });
            clearFormDraft();
          }}
        >
          <label className={styles.field}>
            نوع المتابعة
            <GlassSelect {...draftField('type', 'اتصال')} name="type">
              {['اتصال', 'رسالة', 'معاينة'].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </GlassSelect>
          </label>
          <label className={styles.field}>
            تاريخ المتابعة القادمة
            <input
              {...draftField('next', '')}
              name="next"
              type="date"
              min={localDate()}
              required
            />
          </label>
          <label className={styles.field}>
            نتيجة التواصل
            <input
              {...draftField('result', '')}
              name="result"
              required
              maxLength={250}
            />
          </label>
          <label className={styles.field}>
            ملاحظة
            <textarea
              {...draftField('note', '')}
              name="note"
              maxLength={1000}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button type="submit">حفظ المتابعة</Button>
            <Button type="button" onClick={onCancel}>
              إلغاء
            </Button>
          </div>
        </form>{' '}
      </>
    </section>
  );
}
