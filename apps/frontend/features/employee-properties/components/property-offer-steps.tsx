import { Button } from '../../../components/ui/button';
import { PropertyDataEditor } from './property-data-editor';
import {
  placeholders,
  propertySummary,
  type PropertyRequestDraft,
} from './property-request-model';
import styles from './property-request.module.css';
import { parsePropertyMessage } from './parse-property-message';
export function PropertyOfferSteps({
  step,
  draft,
  onChange,
  onError,
  onNotice,
  manager,
}: {
  step: number;
  draft: PropertyRequestDraft;
  onChange: (d: PropertyRequestDraft) => boolean | void;
  onError: (value: string) => void;
  onNotice: (value: string) => void;
  manager: boolean;
}) {
  const parsed = draft.parsed;
  return (
    <>
      {' '}
      {step === 2 && (
        <section className={styles.panel}>
          <label className={styles.field}>
            اكتب أو الصق تفاصيل العقار
            <textarea
              className={styles.message}
              value={draft.message}
              placeholder={placeholders[draft.offerType]}
              onChange={(e) =>
                onChange({
                  ...draft,
                  message: e.target.value,
                  parsed: null,
                })
              }
            />
          </label>
          <Button
            type="button"
            onClick={(event) => {
              const form = event.currentTarget.closest('form');
              if (!draft.message.trim()) {
                onError('اكتب أو الصق تفاصيل العقار أولًا.');
                return;
              }
              const result = parsePropertyMessage(
                draft.message,
                draft.offerType,
              );
              const accepted = onChange({
                ...draft,
                offerType: result.offerType || draft.offerType,
                parsed: result.parsed,
              });
              if (accepted === false) return;
              requestAnimationFrame(() => {
                const heading = Array.from(
                  form?.querySelectorAll<HTMLElement>(
                    '[data-property-fields]',
                  ) || [],
                ).find(
                  (element) =>
                    element.dataset.propertyFields ===
                    (result.offerType || draft.offerType),
                );
                heading?.scrollIntoView({
                  behavior: window.matchMedia(
                    '(prefers-reduced-motion: reduce)',
                  ).matches
                    ? 'instant'
                    : 'smooth',
                  block: 'start',
                  inline: 'nearest',
                });
              });
              onError('');
              onNotice(
                'تم تحليل بيانات العقار مؤقتًا، راجع الخانات قبل الإرسال',
              );
            }}
          >
            تحليل العقار
          </Button>
          <p className={styles.hint}>
            تحليل محلي تجريبي. أكمل البيانات غير المستخرجة وراجعها قبل الإرسال.
          </p>
        </section>
      )}
      {(step === 2 || step === 3) && parsed && (
        <>
          {step === 2 && (
            <h3 data-property-fields={draft.offerType}>
              بيانات العقار — راجع الخانات وأكمل التفاصيل
            </h3>
          )}
          <div
            className={
              draft.offerType === 'EXCHANGE' ? styles.exchange : undefined
            }
          >
            <PropertyDataEditor
              data={parsed.currentProperty}
              offerType={draft.offerType}
              onChange={(currentProperty) =>
                onChange({
                  ...draft,
                  parsed: { ...parsed, currentProperty },
                })
              }
            />
            {parsed.desiredProperty && (
              <PropertyDataEditor
                desired
                offerType={draft.offerType}
                data={parsed.desiredProperty}
                onChange={(desiredProperty) =>
                  onChange({
                    ...draft,
                    parsed: { ...parsed, desiredProperty },
                  })
                }
              />
            )}
          </div>
          <section className={styles.panel}>
            <h3>خانات إضافية</h3>
            {parsed.customFields.map((field, index) => (
              <div className={styles.custom} key={index}>
                {(['label', 'value'] as const).map((key) => (
                  <label className={styles.field} key={key}>
                    {key === 'label' ? 'اسم الخانة' : 'القيمة'}
                    <input
                      value={field[key]}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          parsed: {
                            ...parsed,
                            customFields: parsed.customFields.map((f, i) =>
                              i === index ? { ...f, [key]: e.target.value } : f,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <Button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...draft,
                      parsed: {
                        ...parsed,
                        customFields: parsed.customFields.filter(
                          (_, i) => i !== index,
                        ),
                      },
                    })
                  }
                >
                  حذف الخانة
                </Button>
              </div>
            ))}
            <Button
              type="button"
              onClick={() =>
                onChange({
                  ...draft,
                  parsed: {
                    ...parsed,
                    customFields: [
                      ...parsed.customFields,
                      { label: '', value: '' },
                    ],
                  },
                })
              }
            >
              إضافة خانة
            </Button>
          </section>
        </>
      )}
      {step === 4 && (
        <section className={styles.panel}>
          <h3>ملخص العقار والمالك</h3>
          <div className={styles.summary}>{propertySummary(draft)}</div>
          <p>الحالة بعد الحفظ: {manager ? 'معتمد' : 'بانتظار الموافقة'}</p>
        </section>
      )}
    </>
  );
}
