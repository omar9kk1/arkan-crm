import { GlassSelect } from '../../../../components/ui/glass-select';
import { requestTypes } from '../../client-model';
import type { RequestDraft } from './model';
import fields from '../clients.module.css';
import styles from './request-wizard.module.css';
export function ClientRequestFormStep({
  draft,
  onChange,
}: {
  draft: RequestDraft;
  onChange: (draft: RequestDraft) => void;
}) {
  return (
    <>
      <h3>بيانات العميل والطلب</h3>
      <div className={styles.formGrid}>
        {[
          { key: 'name', label: 'اسم العميل', type: 'text' },
          { key: 'phone', label: 'رقم الهاتف', type: 'tel' },
          { key: 'area', label: 'المنطقة المطلوبة', type: 'text' },
          { key: 'budget', label: 'الميزانية (د.ك)', type: 'number' },
        ].map((f) => (
          <label key={f.key} className={fields.field}>
            {f.label}
            <input
              type={f.type}
              required
              maxLength={150}
              min={f.type === 'number' ? '0.001' : undefined}
              step={f.type === 'number' ? '0.001' : undefined}
              value={draft[f.key as 'name' | 'phone' | 'area' | 'budget']}
              onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
            />
          </label>
        ))}
        <label className={fields.field}>
          نوع الطلب
          <GlassSelect
            value={draft.type}
            onChange={(e) => onChange({ ...draft, type: e.target.value })}
          >
            {requestTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </GlassSelect>
        </label>
        <label className={fields.field}>
          ملاحظات
          <textarea
            maxLength={1000}
            value={draft.notes}
            onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          />
        </label>
      </div>
    </>
  );
}
