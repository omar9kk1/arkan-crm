'use client';
import {
  useDraftState,
  useDraftScope,
  useDraftFields,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';

import { GlassSelect } from '../../../components/ui/glass-select';

import { useRef, useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import {
  type Currency,
  propertyOptions,
  localDate,
  parseAmount,
  type ManualExpenseDraft,
} from '../finance-model';
import styles from './finance.module.css';
export function ManualExpenseModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (draft: ManualExpenseDraft) => void;
}) {
  const formKey = 'manual-expense';
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const draftField = useDraftFields(formKey);

  const [currency, setCurrency] = useDraftState<Currency>(
    formKey + ':currency',
    'KWD',
  );
  const [linked, setLinked] = useDraftState(formKey + ':linked', false);
  const [error, setError] = useState('');
  const submitted = useRef(false);
  return (
    <PropertyOverlay title="تسجيل مصروف يدوي" onClose={onClose}>
      <p className={styles.muted}>سيُضاف المصروف إلى المعاينة المحلية فقط.</p>
      <>
        <DraftTools formKey={formKey} />{' '}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (submitted.current) return;
            const data = new FormData(event.currentTarget);
            const amount = parseAmount(String(data.get('amount')), currency);
            const description = String(data.get('description') ?? '').trim();
            const date = String(data.get('date'));
            if (
              amount === null ||
              !description ||
              !String(data.get('type') || '').trim()
            ) {
              setError(
                'أدخل نوع المصروف والوصف ومبلغًا صحيحًا؛ المصري حتى منزلتين والكويتي حتى 3 منازل عشرية.',
              );
              return;
            }
            submitted.current = true;
            onSave({
              expenseType: String(data.get('type')).trim(),
              currency,
              amountFils: amount,
              date,
              property: linked ? String(data.get('property')) : '',
              description,
            });
            clearFormDraft();
          }}
        >
          <label className={styles.field}>
            نوع المصروف
            <input
              {...draftField('type', '')}
              name="type"
              required
              maxLength={120}
              placeholder="اكتب نوع المصروف..."
            />
          </label>
          <div className={styles.amountFields}>
            <label className={styles.field}>
              المبلغ
              <input
                {...draftField('amount', '')}
                name="amount"
                type="number"
                min={currency === 'EGP' ? '0.01' : '0.001'}
                max="1000000000"
                step={currency === 'EGP' ? '0.01' : '0.001'}
                required
              />
            </label>
            <label className={styles.field}>
              العملة
              <GlassSelect
                value={currency}
                onChange={(event) =>
                  setCurrency(event.target.value as Currency)
                }
              >
                <option value="KWD">دينار كويتي (د.ك)</option>
                <option value="EGP">جنيه مصري (ج.م)</option>
              </GlassSelect>
            </label>
          </div>
          <label className={styles.field}>
            التاريخ
            <input
              {...draftField('date', localDate())}
              name="date"
              type="date"
              required
            />
          </label>
          <label className={styles.field}>
            ارتباط العقار
            <GlassSelect
              value={linked ? 'linked' : 'none'}
              onChange={(event) => setLinked(event.target.value === 'linked')}
            >
              <option value="none">غير مرتبط بعقار</option>
              <option value="linked">مرتبط بعقار</option>
            </GlassSelect>
          </label>
          {linked && (
            <label className={styles.field}>
              العقار
              <GlassSelect
                {...draftField('property', '')}
                name="property"
                required
              >
                <option value="">اختر العقار</option>
                {propertyOptions.map((property) => (
                  <option key={property}>{property}</option>
                ))}
              </GlassSelect>
            </label>
          )}
          <label className={styles.field}>
            الوصف
            <textarea
              {...draftField('description', '')}
              name="description"
              required
              maxLength={1000}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button type="submit">حفظ</Button>
        </form>{' '}
      </>
    </PropertyOverlay>
  );
}
