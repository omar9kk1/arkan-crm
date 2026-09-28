import {
  useDraftState,
  useDraftScope,
  useDraftFields,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';
import { useState } from 'react';
import { GlassSelect } from '../../../components/ui/glass-select';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { targets, type Kind, type Followup } from '../model';
import { FollowupModalShell } from './followup-modal-shell';
import fields from '../../employee-clients/components/clients.module.css';
import styles from './followups.module.css';
export function AddFollowupModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (item: Followup) => void;
}) {
  const formKey = 'add-followup';
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const draftField = useDraftFields(formKey);

  const [kind, setKind] = useDraftState<Kind>(formKey + ':kind', 'عميل');
  const [targetId, setTargetId] = useDraftState(formKey + ':targetId', '');
  const [error, setError] = useState('');
  const selected = targets.find(
    (target) => target.id === targetId && target.kind === kind,
  );
  return (
    <FollowupModalShell
      title="تسجيل متابعة جديدة"
      onClose={onClose}
      separatePanels
    >
      <>
        <DraftTools formKey={formKey} />{' '}
        <form
          className={styles.stack}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const reason = String(data.get('reason') || '').trim();
            if (!selected || !reason) {
              setError('اختر الطرف وأدخل تفاصيل المتابعة.');
              return;
            }
            const note = String(data.get('note') || '').trim();
            const due = String(data.get('due'));
            onSave({
              ...selected,
              id:
                globalThis.crypto?.randomUUID?.() ??
                `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              due,
              reason,
              note,
              complete: false,
              history: [
                {
                  date: new Date().toISOString(),
                  result: String(data.get('result')),
                  note: [String(data.get('method')), reason, note]
                    .filter(Boolean)
                    .join(' — '),
                  next: due,
                },
              ],
            });
            clearFormDraft();
          }}
        >
          <Card>
            <fieldset className={styles.typeChoices}>
              <legend>نوع المتابعة</legend>
              {(['عميل', 'مالك', 'عقار'] as Kind[]).map((type) => (
                <label key={type} data-selected={kind === type}>
                  <input
                    type="radio"
                    name="kind"
                    checked={kind === type}
                    onChange={() => {
                      setKind(type);
                      setTargetId('');
                    }}
                  />
                  متابعة {type}
                </label>
              ))}
            </fieldset>
            <div className={styles.formGrid}>
              <label className={fields.field}>
                الشخص / الجهة
                <GlassSelect
                  name="target"
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  required
                >
                  <option value="">اختر</option>
                  {targets
                    .filter((target) => target.kind === kind)
                    .map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                </GlassSelect>
              </label>
              <label className={fields.field}>
                رقم الهاتف
                <input
                  dir="ltr"
                  readOnly
                  value={selected?.phone || ''}
                  placeholder="يظهر بعد اختيار الجهة"
                />
              </label>
              <label className={fields.field}>
                مرتبط بـ
                <input
                  readOnly
                  value={selected?.property || selected?.name || ''}
                  placeholder="اختر الجهة أولًا"
                />
              </label>
              <label className={fields.field}>
                طريقة التواصل
                <GlassSelect {...draftField('method', 'اتصال')} name="method">
                  {['اتصال', 'واتساب', 'زيارة', 'رسالة'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </GlassSelect>
              </label>
              <label className={fields.field}>
                نتيجة المتابعة
                <GlassSelect
                  {...draftField('result', 'تم التواصل')}
                  name="result"
                >
                  {['تم التواصل', 'لم يرد', 'طلب مهلة', 'تم الاتفاق'].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </GlassSelect>
              </label>
              <label className={fields.field}>
                موعد المتابعة القادمة
                <input
                  {...draftField('due', '')}
                  name="due"
                  type="datetime-local"
                  required
                />
              </label>
              <label className={`${fields.field} ${styles.fullField}`}>
                تفاصيل المتابعة
                <input
                  {...draftField('reason', '')}
                  name="reason"
                  required
                  maxLength={250}
                  placeholder="ملخص التواصل والخطوة القادمة"
                />
              </label>
            </div>
          </Card>
          <Card>
            <label className={fields.field}>
              ملاحظات المتابعة
              <textarea
                {...draftField('note', '')}
                className={styles.notesInput}
                name="note"
                maxLength={1000}
                placeholder="اكتب ملاحظات المتابعة هنا..."
              />
            </label>
          </Card>
          {error && <p role="alert">{error}</p>}
          <div className={styles.formActions}>
            <Button type="button" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit">حفظ المتابعة</Button>
          </div>
        </form>{' '}
      </>
    </FollowupModalShell>
  );
}
