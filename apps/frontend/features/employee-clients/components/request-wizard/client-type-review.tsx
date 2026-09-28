import { Button } from '../../../../components/ui/button';
import { RequestDetailsEditor } from './request-details-editor';
import {
  requestSummary,
  type ClientRequestDraft,
} from './client-request-model';
import styles from './unified-request.module.css';
export function ClientTypeReview({
  draft,
  onChange,
}: {
  draft: ClientRequestDraft;
  onChange: (d: ClientRequestDraft) => void;
}) {
  const details = draft.requestDetails;
  if (!draft.interest.hasNewRequest || !details)
    return <p className={styles.summary}>{requestSummary(draft)}</p>;
  return (
    <>
      <div
        className={
          draft.clientType === 'EXCHANGER' ? styles.exchange : undefined
        }
      >
        {details.currentProperty && (
          <RequestDetailsEditor
            title="بيانات عقار العميل الحالي"
            current
            data={details.currentProperty}
            onChange={(currentProperty) =>
              onChange({
                ...draft,
                requestDetails: { ...details, currentProperty },
              })
            }
          />
        )}
        <RequestDetailsEditor
          title="بيانات العقار المطلوب"
          exchange={draft.clientType === 'EXCHANGER'}
          data={details.desiredProperty}
          onChange={(desiredProperty) =>
            onChange({
              ...draft,
              requestDetails: { ...details, desiredProperty },
            })
          }
        />
      </div>
      <section className={styles.panel}>
        <h3>خانات إضافية</h3>
        {details.customFields.map((field, index) => (
          <div className={styles.custom} key={index}>
            {(['label', 'value'] as const).map((key) => (
              <label className={styles.field} key={key}>
                {key === 'label' ? 'اسم الخانة' : 'القيمة'}
                <input
                  value={field[key]}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      requestDetails: {
                        ...details,
                        customFields: details.customFields.map((f, i) =>
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
                  requestDetails: {
                    ...details,
                    customFields: details.customFields.filter(
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
              requestDetails: {
                ...details,
                customFields: [
                  ...details.customFields,
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
  );
}
