import { Button } from '../../../../components/ui/button';
import { sampleProperties, type RequestDraft } from './model';
import fields from '../clients.module.css';
import styles from './request-wizard.module.css';
export function SmartPastePanel({
  draft,
  onChange,
}: {
  draft: RequestDraft;
  onChange: (draft: RequestDraft) => void;
}) {
  return (
    <>
      <fieldset className={styles.choices}>
        <legend>طريقة إضافة العميل</legend>
        {[
          {
            id: 'new',
            title: 'عميل له طلب جديد',
            description:
              'العميل يبحث عن عقار والنظام يطابق له العقارات المناسبة.',
          },
          {
            id: 'existing',
            title: 'عميل على عقار موجود',
            description: 'العميل يسأل عن عقار محدد موجود بالفعل في النظام.',
          },
        ].map((option) => (
          <label
            key={option.id}
            className={styles.choice}
            data-selected={draft.mode === option.id}
          >
            <input
              type="radio"
              name="request-mode"
              checked={draft.mode === option.id}
              onChange={() =>
                onChange({ ...draft, mode: option.id as RequestDraft['mode'] })
              }
            />
            <strong>{option.title}</strong>
            <p>{option.description}</p>
          </label>
        ))}
      </fieldset>
      {draft.mode === 'new' && (
        <div className={styles.pastePanel}>
          <h3>نص رسالة العميل</h3>
          <label className={fields.field}>
            Smart Paste
            <textarea
              className={styles.message}
              maxLength={500}
              placeholder="الصق رسالة العميل هنا..."
              value={draft.message}
              onChange={(e) => onChange({ ...draft, message: e.target.value })}
            />
          </label>
          <Button
            type="button"
            onClick={() => onChange({ ...draft, message: '' })}
          >
            مسح النص
          </Button>
          <small>
            {draft.message.length}/500 — إدخال يدوي في الخطوة التالية، دون تحليل
            تلقائي.
          </small>
        </div>
      )}

      {draft.mode === 'existing' && (
        <fieldset className={styles.choices}>
          <legend>اختيار العقار الموجود</legend>
          {sampleProperties.map((property) => (
            <label
              key={property.name}
              className={styles.choice}
              data-selected={draft.property === property.name}
            >
              <input
                type="radio"
                name="linked-property"
                required
                checked={draft.property === property.name}
                onChange={() => onChange({ ...draft, property: property.name })}
              />
              <span className={styles.propertyImage} aria-hidden="true" />
              <strong>{property.name}</strong>
              <p>
                {property.area} · {property.price}
              </p>
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
