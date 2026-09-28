import { GlassCombobox } from '../../../../components/ui/glass-combobox';
import { Button } from '../../../../components/ui/button';
import { GlassSelect } from '../../../../components/ui/glass-select';
import {
  placeholders,
  properties,
  type ClientRequestDraft,
} from './client-request-model';
import styles from './unified-request.module.css';
export function RequestInterestStep({
  draft,
  onChange,
  onAnalyze,
}: {
  draft: ClientRequestDraft;
  onChange: (draft: ClientRequestDraft) => void;
  onAnalyze: () => void;
}) {
  const property = properties.find(
    (p) => p.id === draft.linkedProperty.propertyId,
  );
  return (
    <>
      <div className={styles.grid}>
        {(
          [
            [
              'hasLinkedProperty',
              'العميل يسأل عن عقار موجود',
              'استخدم هذا لو العميل تواصل بسبب عقار موجود بالفعل في البرنامج.',
            ],
            [
              'hasNewRequest',
              'العميل لديه طلب جديد',
              'استخدم هذا لو العميل يبحث عن مواصفات معينة أو لديه طلب مختلف.',
            ],
          ] as const
        ).map(([key, title, description]) => (
          <button
            type="button"
            className={styles.choice}
            key={key}
            aria-pressed={draft.interest[key]}
            onClick={() =>
              onChange({
                ...draft,
                interest: { ...draft.interest, [key]: !draft.interest[key] },
              })
            }
          >
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      {draft.interest.hasLinkedProperty && (
        <section className={styles.panel}>
          <h3>ربط عقار من البرنامج</h3>
          <label className={styles.field}>
            العقار
            <GlassCombobox
              label="العقار"
              placeholder="ابحث بالكود أو المنطقة واختر العقار..."
              value={draft.linkedProperty.propertyId}
              options={properties.map((p) => ({
                value: p.id,
                label: `${p.id} · ${p.name} · ${p.area}`,
              }))}
              onChange={(value) =>
                onChange({
                  ...draft,
                  linkedProperty: {
                    ...draft.linkedProperty,
                    propertyId: value,
                  },
                })
              }
            />
          </label>
          {property && (
            <p className={styles.preview}>
              {property.id} · {property.area} · {property.price} ·{' '}
              {property.type} · {property.status}
            </p>
          )}
          <div className={styles.grid}>
            <label className={styles.field}>
              سبب الاهتمام
              <GlassSelect
                value={draft.linkedProperty.reason}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    linkedProperty: {
                      ...draft.linkedProperty,
                      reason: e.target.value,
                    },
                  })
                }
              >
                {[
                  'استفسار',
                  'طلب معاينة',
                  'تفاوض على السعر',
                  'يريد بديل مشابه',
                ].map((reason) => (
                  <option key={reason}>{reason}</option>
                ))}
              </GlassSelect>
            </label>
            <label className={styles.field}>
              ملاحظات العميل على هذا العقار
              <textarea
                value={draft.linkedProperty.notes}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    linkedProperty: {
                      ...draft.linkedProperty,
                      notes: e.target.value,
                    },
                  })
                }
              />
            </label>
          </div>
        </section>
      )}
      {draft.interest.hasNewRequest && (
        <section className={styles.panel}>
          <h3>تفاصيل الطلب الجديد</h3>
          <label className={styles.field}>
            اكتب أو الصق تفاصيل الطلب
            <textarea
              className={styles.message}
              value={draft.message}
              placeholder={placeholders[draft.clientType]}
              onChange={(e) =>
                onChange({
                  ...draft,
                  message: e.target.value,
                  requestDetails: null,
                })
              }
            />
          </label>
          <Button type="button" onClick={onAnalyze}>
            تحليل الطلب
          </Button>
          <p className={styles.hint}>
            تحليل محلي تجريبي، راجع الحقول وأكمل البيانات غير المستخرجة.
          </p>
        </section>
      )}
    </>
  );
}
