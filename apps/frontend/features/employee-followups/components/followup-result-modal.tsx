import {
  useDraftState,
  useDraftScope,
  useDraftFields,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';

import { GlassSelect } from '../../../components/ui/glass-select';
import { Button } from '../../../components/ui/button';
import { recordResult, type Followup } from '../model';
import { FollowupModalShell } from './followup-modal-shell';
import fields from '../../employee-clients/components/clients.module.css';
export function FollowupResultModal({
  item,
  onClose,
  onSave,
}: {
  item: Followup;
  onClose: () => void;
  onSave: (item: Followup) => void;
}) {
  const formKey = 'followup-result:' + item.id;
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const draftField = useDraftFields(formKey);

  const [complete, setComplete] = useDraftState(formKey + ':complete', false);
  return (
    <FollowupModalShell title={'تسجيل نتيجة — ' + item.name} onClose={onClose}>
      <>
        <DraftTools formKey={formKey} />{' '}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            onSave(
              recordResult(
                item,
                String(d.get('result')),
                String(d.get('note') || '').trim(),
                complete ? '' : String(d.get('next')),
                complete,
              ),
            );
            clearFormDraft();
          }}
        >
          <label className={fields.field}>
            نتيجة التواصل
            <GlassSelect {...draftField('result', 'تم التواصل')} name="result">
              {[
                'تم التواصل',
                'لم يرد',
                'مهتم',
                'غير مهتم',
                'يحتاج معاينة',
                'مؤجل',
              ].map((result) => (
                <option key={result}>{result}</option>
              ))}
            </GlassSelect>
          </label>
          <label className={fields.field}>
            ملاحظة النتيجة
            <textarea
              {...draftField('note', '')}
              name="note"
              maxLength={1000}
            />
          </label>
          <label className={fields.field}>
            تاريخ ووقت المتابعة القادمة
            <input
              {...draftField('next', '')}
              name="next"
              type="datetime-local"
              required={!complete}
              disabled={complete}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={complete}
              onChange={(e) => setComplete(e.target.checked)}
            />{' '}
            هل تم إنهاء المتابعة؟
          </label>
          <p>عند الإنهاء لن يكون هناك موعد متابعة قادمة.</p>
          <Button type="submit">حفظ</Button>
        </form>{' '}
      </>
    </FollowupModalShell>
  );
}
